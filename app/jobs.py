"""Persistent jobs; CPU parsers run in cancellable, isolated child processes."""

import base64
import concurrent.futures
import json
import subprocess
import sys
import time
from pathlib import Path
from .store import atomic, json_bytes, now, uid
from .topics import summarize, classify
from .translation import translate, prose
from .parsers import parse_file
from .network import fetch_public
from .ocr import local_ocr
from .provider import Provider


def parse_worker(path, kind, output):
    try:
        result = {"result": parse_file(path, kind)}
    except Exception as error:
        result = {"error": str(error)[:600]}
    atomic(output, json_bytes(result))


class Worker:
    def __init__(self, mode, path, kind, output):
        self.args = (
            [sys.executable, "--worker"] if getattr(sys, "frozen", False) else [sys.executable, "-m", "app.worker"]
        ) + [mode, str(path), kind, str(output)]
        self.process = None

    def start(self):
        self.process = subprocess.Popen(
            self.args,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )

    def is_alive(self):
        return self.process.poll() is None

    def terminate(self):
        self.process.terminate()

    def join(self, timeout=None):
        try:
            self.process.wait(timeout)
        except subprocess.TimeoutExpired:
            pass


class Jobs:
    def __init__(self, store, provider):
        self.store = store
        self.provider = provider
        self.pool = concurrent.futures.ThreadPoolExecutor(max_workers=2)
        self.cancelled = set()
        self.futures = {}
        self.job_providers = {}
        self.deleting = set()
        self.active = {}
        self.closing = False
        for job in self.list():
            if job["state"] == "interrupted" and job["stage"] == "parse":
                try:
                    source = self.store.get("sources", job["source_id"])
                    if source["parse_status"] in ("running", "queued"):
                        source["parse_status"] = "interrupted"
                        self.store.save("sources", source, source["revision"])
                except FileNotFoundError:
                    pass

        # Upgrade old local PDF results; never make cloud calls during startup.
        for source in self.store.all("sources"):
            if (
                source["kind"] == "pdf"
                and source.get("parser_version") != "0.1.5"
                and source.get("parse_status") in ("succeeded", "needs_ocr")
            ):
                self.submit(source["id"])

    def delete_source(self, source_id):
        with self.store.lock:
            self.store.get("sources", source_id)
            self.deleting.add(source_id)
            jobs = [j for j in self.list() if j["source_id"] == source_id and j["state"] in ("running", "queued")]
            for job in jobs:
                self.cancel(job["id"])
        try:
            for job in jobs:
                future = self.futures.get(job["id"])
                if future:
                    future.result(timeout=90)
            return self.store.delete_source(source_id)
        finally:
            self.deleting.discard(source_id)

    def list(self):
        with self.store.operations() as db:
            return [dict(r) for r in db.execute("SELECT * FROM jobs ORDER BY created DESC LIMIT 200")]

    def state(self, ident, state, error=""):
        with self.store.operations() as db:
            db.execute("UPDATE jobs SET state=?,error=?,updated=? WHERE id=?", (state, error, now(), ident))

    def submit(self, source_id, stage="parse", cloud=False, authorized=False):
        with self.store.lock, self.store.operations() as db:
            row = db.execute(
                "SELECT id FROM jobs WHERE source_id=? AND state IN ('queued','running')", (source_id,)
            ).fetchone()
            if row:
                return row[0]
            if source_id in self.deleting:
                raise ValueError("此文献正在删除")
            if self.closing:
                raise ValueError("应用正在退出")
            ident = uid()
            db.execute("INSERT INTO jobs VALUES(?,?,?,?,?,?,?)", (ident, source_id, stage, "queued", "", now(), now()))
            if cloud:
                snapshot = Provider(self.store)
                snapshot.settings = dict(self.provider.settings)
                self.job_providers[ident] = snapshot
        self.futures[ident] = self.pool.submit(self.run, ident, source_id, stage, cloud, authorized)
        return ident

    def cancel(self, ident):
        self.cancelled.add(ident)
        self.state(ident, "cancelled", "用户取消；已存原件保留")
        return {"cancelled": True}

    def run(self, ident, source_id, stage, cloud, authorized):
        process = None
        provider = self.job_providers.get(ident, self.provider)
        output = self.store.root / "staging" / f"{ident}.json"
        try:
            if ident in self.cancelled:
                return
            self.state(ident, "running")
            source = self.store.get("sources", source_id)
            if stage == "parse":
                with self.store.lock:
                    source = self.store.get("sources", source_id)
                    source["parse_status"] = "running"
                    source = self.store.save("sources", source, source["revision"])
            parsed = None
            if stage == "parse":
                if source["kind"] == "url":
                    data, final_url = fetch_public(source["url"])
                    # URL placeholder remains immutable; a snapshot is a separate original asset.
                    snapshot = self.store.root / "assets" / source_id / f"snapshot-{uid()}.html"
                    atomic(snapshot, data)
                    parse_path = snapshot
                else:
                    parse_path = self.store.root / source["original"]
                process = Worker("parse", parse_path, source["kind"], output)
                process.start()
                self.active[ident] = process
                started = time.monotonic()
                while process.is_alive():
                    if ident in self.cancelled or self.closing:
                        process.terminate()
                        raise InterruptedError("已取消处理，原件保留")
                    if time.monotonic() - started > 180:
                        process.terminate()
                        raise ValueError("解析超时；可重试或仅保留原件")
                    process.join(0.15)
                if not output.exists():
                    raise ValueError("解析进程异常退出，原件保留")
                payload = json.loads(output.read_text("utf8"))
                if "error" in payload:
                    raise ValueError(payload["error"])
                parsed = payload["result"]
            elif stage == "translation":

                def save_checkpoint(translated):
                    with self.store.lock:
                        current = self.store.get("sources", source_id)
                        if current["parse_revision"] != source["parse_revision"]:
                            raise ValueError("正文版本已改变，未保存新译文，请重新翻译")
                        current["translation"] = translated
                        self.store.save("sources", current, current["revision"])

                translate(
                    source,
                    provider,
                    authorized and cloud,
                    lambda: ident in self.cancelled or self.closing,
                    lambda n, total: self.state(ident, "running", f"已保存译文：{n}/{total}片段"),
                    save_checkpoint,
                )
            elif stage == "summary" and cloud:
                if not source["blocks"]:
                    raise ValueError("没有可用正文")
                quotes = []
                # All chunks, not just the first pages. Every model quote is checked against raw.
                text_blocks = [b for b in source["blocks"] if b.get("raw")]
                for start in range(0, len(text_blocks), 12):
                    if ident in self.cancelled:
                        raise InterruptedError("已取消提炼")
                    part = text_blocks[start : start + 12]
                    result = provider.call(
                        "summary",
                        source_id,
                        {
                            "task": '从每个部分提取核心原句。返回 {"quotes":[{"block_id":"...","quote":"精确原句"}]}',
                            "blocks": [{"id": b["id"], "raw": b["raw"]} for b in part],
                        },
                        authorized,
                    )
                    for item in result.get("quotes", []):
                        block = next((b for b in part if b["id"] == item.get("block_id")), None)
                        from .answer_support import original_quote

                        quote = original_quote(item.get("quote"), block["raw"]) if block else None
                        if quote:
                            quotes.append({**item, "quote": quote})
                if not quotes:
                    raise ValueError("模型没有提供可核对的原文，保留本地摘要")
                if ident in self.cancelled:
                    raise InterruptedError("已取消摘要")
                synthesized = provider.call(
                    "summary",
                    source_id,
                    {
                        "task": '根据已核对原句综合为一段约300字中文内容摘要（250—350字），说明问题、核心观点、论证和结论；不要列点，不添加材料外事实。返回 JSON {"summary":"..."}。',
                        "quotes": quotes,
                    },
                    authorized,
                )
                summary_text = synthesized.get("summary", "")
                if not isinstance(summary_text, str) or not 50 <= len(summary_text.strip()) <= 450:
                    raise ValueError("模型未返回有效的约300字摘要，原有摘要保留")
                if ident in self.cancelled:
                    raise InterruptedError("已取消摘要")
                with self.store.lock:
                    current = self.store.get("sources", source_id)
                    if current["parse_revision"] != source["parse_revision"]:
                        raise ValueError("正文版本已改变，请重新提炼")
                    current["summary"] = {
                        "mode": "model-summary",
                        "text": prose(summary_text),
                        "quotes": quotes,
                        "evidence_ids": list(dict.fromkeys(q["block_id"] for q in quotes)),
                        "coverage": source["coverage"],
                        "version": uid(),
                        "label": "模型内容摘要（约300字，待核对）",
                        "keywords": source["summary"].get("keywords", []),
                    }
                    current["semantic_status"] = "succeeded"
                    self.apply_classification(current)
                    self.store.save("sources", current, current["revision"])
            elif stage == "llm_parse":
                from .llm_parse import parse_with_model

                parsed_model = parse_with_model(
                    source,
                    self.store,
                    provider,
                    authorized and cloud,
                    lambda: ident in self.cancelled or self.closing,
                )
                with self.store.lock:
                    current = self.store.get("sources", source_id)
                    if current["revision"] != source["revision"]:
                        raise ValueError("文献在处理期间已修改，未替换结果")
                    if ident in self.cancelled:
                        raise InterruptedError("已取消模型解析")
                    current.update(
                        blocks=parsed_model["blocks"],
                        parse_revision=current["parse_revision"] + 1,
                        parse_status="needs_review",
                        parser_version="0.1.5",
                        parse_method="llm",
                    )
                    if current.get("title_origin") != "manual" and parsed_model["metadata"].get("title"):
                        current["title"] = parsed_model["metadata"]["title"]
                        current["title_origin"] = "extracted"
                    for key, value in parsed_model["metadata"].items():
                        if (
                            key != "title"
                            and value
                            and (
                                not current["bibliography"].get(key)
                                or (key == "type" and current["bibliography"].get(key) == "excerpt")
                            )
                        ):
                            current["bibliography"][key] = value
                    current["coverage"] = parsed_model["coverage"]
                    current["warnings"] = [
                        "LLM 已替换整理结果；原件保留，识别文字与来源、页码须人工核对。可重新解析恢复规则结果。"
                    ]
                    if current.get("summary", {}).get("mode") != "manual":
                        current["summary"] = summarize(current["blocks"], current["coverage"])
                    self.store.save("sources", current, current["revision"])
            elif stage == "ocr":
                if source["kind"] not in ("pdf", "png", "jpg", "jpeg", "webp"):
                    raise ValueError("OCR 仅适用于图片和 PDF")
                process = Worker("render", self.store.root / source["original"], source["kind"], output)
                process.start()
                self.active[ident] = process
                started = time.monotonic()
                while process.is_alive():
                    if ident in self.cancelled or self.closing or time.monotonic() - started > 180:
                        process.terminate()
                        raise InterruptedError("OCR 已取消或超时")
                    process.join(0.15)
                payload = json.loads(output.read_text("utf8"))
                if "error" in payload:
                    raise ValueError(payload["error"])
                derived = []
                for image in payload["images"]:
                    if ident in self.cancelled:
                        raise InterruptedError("OCR 已取消")
                    image_path = self.store.root / "staging" / f"{ident}-{image['page_index']}.png"
                    atomic(image_path, base64.b64decode(image["data"]))
                    try:
                        text = local_ocr(image_path)
                        method = "tesseract"
                        if text is None:
                            if not cloud:
                                raise ValueError("未找到本地 Tesseract；可安装中文 OCR 组件或授权云端识别")
                            result = provider.call(
                                "ocr",
                                source_id,
                                {
                                    "task": '识别图片文字，保持段落。只返回 JSON {"text":"识别文字"}，看不清的字符用□，不要猜测。',
                                    "page_index": image["page_index"],
                                    "images": [image["data"]],
                                },
                                authorized,
                            )
                            text = result.get("text", "")
                            method = "vision-api"
                        if text:
                            derived.append(
                                {
                                    "id": "ocr-" + str(image["page_index"]),
                                    "type": "text",
                                    "raw": text,
                                    "clean": text,
                                    "locator": {"page_index": image["page_index"], "printed_page": None, "ocr": True},
                                    "ocr_method": method,
                                    "verified": False,
                                }
                            )
                    finally:
                        image_path.unlink(missing_ok=True)
                if not derived:
                    raise ValueError("未识别到文字；保留原件")
                with self.store.lock:
                    current = self.store.get("sources", source_id)
                    current["blocks"] = [b for b in current["blocks"] if not b.get("ocr_method")] + derived
                    current["parse_revision"] += 1
                    current["parse_status"] = "needs_review"
                    current["warnings"].append("OCR 文字属于衍生识别结果，尚未人工核对，不能视为精确原文。")
                    current["summary"] = summarize(current["blocks"], current.get("coverage", {}))
                    self.apply_classification(current)
                    self.store.save("sources", current, current["revision"])
            elif stage in ("classify", "summary"):
                with self.store.lock:
                    source = self.store.get("sources", source_id)
                    if stage == "summary":
                        source["summary"] = summarize(source.get("blocks", []), source.get("coverage", {}))
                    self.apply_classification(source)
                    self.store.save("sources", source, source["revision"])
            if parsed is not None:
                if ident in self.cancelled:
                    raise InterruptedError("已取消处理")
                with self.store.lock:
                    current = self.store.get("sources", source_id)
                    revision = current["parse_revision"] + 1
                    for name, asset in parsed.pop("assets").items():
                        atomic(
                            self.store.root / "assets" / source_id / str(revision) / name,
                            base64.b64decode(asset["data"]),
                        )
                    current.update(
                        blocks=parsed["blocks"],
                        coverage=parsed["coverage"],
                        warnings=parsed["warnings"],
                        parse_revision=revision,
                        asset_revision=revision,
                        parser_version="0.1.5",
                        parse_status="succeeded" if parsed["coverage"]["complete"] else "needs_ocr",
                        semantic_status="local_only",
                    )
                    extracted_title = parsed["metadata"].get("title", "")
                    if (
                        extracted_title
                        and (
                            current.get("title_origin") != "manual"
                            or (current["kind"] == "url" and current["title"] in ("网页资料", "网页"))
                        )
                        and (
                            current.get("title_origin") == "extracted"
                            or current["title"] == Path(current["filename"]).stem
                            or (current["kind"] == "url" and current["title"] == "网页资料")
                        )
                    ):
                        current["title"] = extracted_title
                        current["title_origin"] = "extracted"
                    for key, value in parsed["metadata"].items():
                        if (
                            value
                            and key != "title"
                            and (
                                not current["bibliography"].get(key)
                                or (key == "type" and current["bibliography"].get(key) == "excerpt")
                            )
                        ):
                            current["bibliography"][key] = value
                    if source["kind"] == "url":
                        current["snapshot"] = snapshot.relative_to(self.store.root).as_posix()
                    if current.get("summary", {}).get("mode") != "manual":
                        current["summary"] = summarize(current["blocks"], current["coverage"])
                    self.apply_classification(current)
                    self.store.save("sources", current, current["revision"])
            self.state(ident, "succeeded")
        except InterruptedError as error:
            self.state(ident, "cancelled", str(error))
            if stage == "parse":
                with self.store.lock:
                    current = self.store.get("sources", source_id)
                    current["parse_status"] = "cancelled"
                    self.store.save("sources", current, current["revision"])
        except Exception as error:
            self.state(ident, "failed", str(error)[:600])
            if stage == "parse":
                with self.store.lock:
                    current = self.store.get("sources", source_id)
                    current.update(parse_status="failed", parse_error=str(error)[:600])
                    self.store.save("sources", current, current["revision"])
        finally:
            if process:
                if process.is_alive():
                    process.terminate()
                process.join(3)
            self.active.pop(ident, None)
            self.job_providers.pop(ident, None)
            output.unlink(missing_ok=True)

    def apply_classification(self, source):
        samples = [s for s in self.store.all("sources") if s.get("confirmed") and s["id"] != source["id"]]
        run = classify(source.get("summary", {}), samples)
        run["id"] = uid()
        source["classification"] = run
        if not source.get("confirmed"):
            source.update(topic_ids=run["topic_ids"], primary_topic_id=run["primary_topic_id"])

    def shutdown(self):
        self.closing = True
        for ident in list(self.active):
            self.cancel(ident)
        self.pool.shutdown(wait=True, cancel_futures=True)
