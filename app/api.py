"""Authenticated localhost API. It does not read process environment provider keys."""

import mimetypes
import secrets
from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, Form, Request
from fastapi.responses import JSONResponse, FileResponse
from .contracts import (
    TextInput,
    HighlightsInput,
    URLInput,
    TopicsInput,
    RevisionInput,
    MetadataInput,
    SummaryInput,
    NoteInput,
    SearchInput,
    AnalyzeInput,
    ProviderInput,
)
from .store import Store, Conflict, uid
from .jobs import Jobs
from .provider import Provider
from .answer_support import answer_payload, linked_claims
from .citations import citation
from .backup import export_library, validate_backup, restore_backup


def create_app(root, token, provider_settings=None):
    store = Store(root)
    provider = Provider(store)
    if provider_settings:
        provider.configure(provider_settings)
    jobs = Jobs(store, provider)

    @asynccontextmanager
    async def lifespan(app):
        yield
        jobs.shutdown()
        store.close()

    app = FastAPI(title="知拾本地引擎", version="1.0.0", lifespan=lifespan)
    app.state.store, app.state.jobs, app.state.provider = store, jobs, provider

    @app.middleware("http")
    async def authenticate(request: Request, call_next):
        host = request.headers.get("host", "").split(":")[0]
        if host not in ("127.0.0.1", "localhost", "testserver") or not secrets.compare_digest(
            request.headers.get("authorization", ""), "Bearer " + token
        ):
            return JSONResponse({"code": "unauthorized", "message": "本地服务认证失败"}, status_code=401)
        if request.headers.get("origin") not in (None, "app://bundle"):
            return JSONResponse({"code": "origin_denied", "message": "禁止跨站访问"}, status_code=403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.exception_handler(Conflict)
    async def conflict(request, error):
        return JSONResponse({"code": "revision_conflict", "message": str(error), "retryable": True}, 409)

    @app.exception_handler(ValueError)
    async def invalid(request, error):
        return JSONResponse({"code": "invalid_request", "message": str(error), "retryable": False}, 400)

    @app.exception_handler(FileNotFoundError)
    async def missing(request, error):
        return JSONResponse({"code": "not_found", "message": "记录或资源不存在", "retryable": False}, 404)

    @app.get("/api/v1/health")
    def health():
        return {
            "status": "ready",
            "api_version": 1,
            "schema_version": 1,
            "library": str(store.root),
            "capabilities": ["files", "notes", "topics", "search", "backup", "model-extraction"],
        }

    @app.get("/api/v1/topics")
    def topics():
        return store.topics()

    @app.get("/api/v1/sources")
    def sources(
        query: str = "",
        topic_ids: str = "",
        topic_mode: str = "any",
        kind: str = "",
        pending: bool = False,
        offset: int = 0,
        limit: int = 50,
    ):
        if offset < 0 or not 1 <= limit <= 100 or topic_mode not in ("any", "all"):
            raise ValueError("分页或筛选参数无效")
        return store.list_sources(
            query, topic_ids.split(",") if topic_ids else [], topic_mode, kind, pending, offset, limit
        )

    @app.get("/api/v1/sources/{ident}")
    def source(ident: str):
        return store.get("sources", ident)

    @app.post("/api/v1/ingest/text")
    def ingest_text(data: TextInput):
        source, duplicate = store.ingest(data.text.encode("utf8"), "摘录.txt", data.title, data.url)
        return {
            "source_id": source["id"],
            "duplicate": duplicate,
            "archived": True,
            "job_id": None if duplicate else jobs.submit(source["id"]),
        }

    @app.post("/api/v1/ingest/url")
    def ingest_url(data: URLInput):
        from urllib.parse import urlsplit

        parsed = urlsplit(data.url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("请输入公开网页地址")
        source, duplicate = store.ingest(data.url.encode("utf8"), "网页.url", data.title, data.url)
        return {
            "source_id": source["id"],
            "duplicate": duplicate,
            "archived": True,
            "job_id": None if duplicate else jobs.submit(source["id"]),
        }

    @app.post("/api/v1/ingest/file")
    async def ingest_file(file: UploadFile = File(...), title: str = Form("")):
        data = await file.read(100 * 1024 * 1024 + 1)
        if len(data) > 100 * 1024 * 1024:
            raise ValueError("文件超过 100 MB，尚未存档，请拆分后导入")
        if not data:
            raise ValueError("文件为空")
        source, duplicate = store.ingest(data, file.filename or "file.bin", title)
        return {
            "source_id": source["id"],
            "duplicate": duplicate,
            "archived": True,
            "job_id": None if duplicate else jobs.submit(source["id"]),
        }

    @app.patch("/api/v1/sources/{ident}")
    def metadata(ident: str, data: MetadataInput):
        with store.lock:
            source = store.get("sources", ident)
            if len(str(data.bibliography)) > 30000:
                raise ValueError("来源字段过长")
            if data.title != source["title"]:
                source["title_origin"] = "manual"
            source.update(title=data.title, bibliography=data.bibliography, tags=data.tags)
            source.setdefault("summary", {})["keywords"] = data.keywords
            source["bibliography_checked_at"] = __import__("datetime").datetime.now().isoformat()
            return store.save("sources", source, data.expected_revision)

    @app.patch("/api/v1/sources/{ident}/highlights")
    def highlights(ident: str, data: HighlightsInput):
        with store.lock:
            source = store.get("sources", ident)
            old = {h["id"]: h for h in source.get("highlights", [])}
            blocks = {b["id"] for b in source.get("blocks", [])}
            marks = [h.model_dump() for h in data.highlights]
            if len({h["id"] for h in marks}) != len(marks):
                raise ValueError("标记编号重复")
            for h in marks:
                if h["end"] <= h["start"]:
                    raise ValueError("标记范围无效")
                if old.get(h["id"]) != h and (
                    h["block_id"] not in blocks or h["parse_revision"] != source["parse_revision"]
                ):
                    raise ValueError("正文已变化，请重新选择文字")
            source["highlights"] = marks
            return store.save("sources", source, data.expected_revision)

    @app.patch("/api/v1/sources/{ident}/topics")
    def update_topics(ident: str, data: TopicsInput):
        return store.set_topics(ident, data.model_dump())

    @app.post("/api/v1/sources/{ident}/topics/undo")
    def undo_topics(ident: str, data: RevisionInput):
        return store.undo_topics(ident, data.expected_revision)

    @app.patch("/api/v1/sources/{ident}/summary")
    def summary(ident: str, data: SummaryInput):
        with store.lock:
            source = store.get("sources", ident)
            source["summary"] = {
                **source.get("summary", {}),
                "mode": "manual",
                "label": "人工摘要",
                "text": data.text,
                "version": uid(),
            }
            jobs.apply_classification(source)
            return store.save("sources", source, data.expected_revision)

    @app.post("/api/v1/sources/{ident}/text")
    def supplement(ident: str, data: TextInput):
        with store.lock:
            source = store.get("sources", ident)
            source["parse_revision"] += 1
            source["blocks"] = [
                {
                    "id": "manual-" + uid(),
                    "type": "text",
                    "raw": data.text,
                    "clean": data.text,
                    "locator": {"paragraph": 1, "manual_transcription": True},
                }
            ]
            source["coverage"] = {"total": 1, "parsed": 1, "complete": True, "unit": "人工补充正文"}
            source["parse_status"] = "succeeded"
            from .topics import summarize

            source["summary"] = summarize(source["blocks"], source["coverage"])
            jobs.apply_classification(source)
            return store.save("sources", source, source["revision"])

    @app.post("/api/v1/sources/{ident}/ocr/confirm")
    def confirm_ocr(ident: str, data: RevisionInput):
        with store.lock:
            source = store.get("sources", ident)
            ocr_blocks = [b for b in source["blocks"] if b.get("ocr_method") and not b.get("verified")]
            if not ocr_blocks:
                raise ValueError("没有待核对的 OCR 文字")
            for block in ocr_blocks:
                block["verified"] = True
            source["coverage"]["parsed"] = min(
                source["coverage"]["total"], source["coverage"]["parsed"] + len(ocr_blocks)
            )
            source["coverage"]["complete"] = source["coverage"]["parsed"] == source["coverage"]["total"]
            source["parse_status"] = "succeeded" if source["coverage"]["complete"] else "needs_ocr"
            source["summary"]["coverage"] = source["coverage"]
            jobs.apply_classification(source)
            return store.save("sources", source, data.expected_revision)

    @app.get("/api/v1/sources/{ident}/original")
    def original(ident: str):
        source = store.get("sources", ident)
        path = store.root / source["original"]
        # Never execute snapshots: HTML downloads are served as plain text.
        media = (
            "text/plain"
            if source["kind"] in ("html", "url")
            else mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        )
        return FileResponse(path, media_type=media, headers={"Content-Security-Policy": "default-src 'none'; sandbox"})

    @app.get("/api/v1/sources/{ident}/assets/{revision}/{name}")
    def asset(ident: str, revision: int, name: str):
        store.get("sources", ident)
        if revision < 1 or not __import__("re").fullmatch(r"image-\d+\.(png|jpg|webp|gif)", name):
            raise ValueError("资源标识无效")
        return FileResponse(store.root / "assets" / ident / str(revision) / name)

    @app.delete("/api/v1/sources/{ident}")
    def delete_source(ident: str):
        return jobs.delete_source(ident)

    @app.get("/api/v1/sources/{ident}/citation")
    def cite(ident: str):
        return citation(store.get("sources", ident))

    @app.post("/api/v1/sources/{ident}/analyze")
    def analyze(ident: str, data: AnalyzeInput):
        with store.lock:
            if data.cloud and (not data.authorized or data.destination != provider.settings.get("base_url")):
                raise ValueError("请确认当前模型服务地址及文献发送授权")
            store.get("sources", ident)
            return {"job_id": jobs.submit(ident, data.stage, data.cloud, data.authorized)}

    @app.get("/api/v1/notes")
    def notes(source_id: str = ""):
        result = [n for n in store.all("notes") if not source_id or n["source_id"] == source_id]
        for note in result:
            note["source_deleted"] = not (store.object_path("sources", note["source_id"]) / "current.json").exists()
        return result

    @app.post("/api/v1/notes")
    def save_note(data: NoteInput):
        return store.save_note(data.model_dump())

    @app.post("/api/v1/search")
    def search(data: SearchInput):
        return store.search(data.query, data.topic_ids, data.topic_mode, data.source_ids, data.limit)

    @app.post("/api/v1/answers")
    def answer(data: SearchInput):
        evidence = search(data)
        claims = []
        if data.cloud and evidence:
            result = provider.call("answers", "query", answer_payload(data.query, evidence), data.authorized)
            claims = linked_claims(result, evidence)
        status = (
            "insufficient"
            if not evidence
            else "evidence_only"
            if not data.cloud
            else "source_linked_answer"
            if claims
            else "insufficient"
        )
        value = {
            "id": uid(),
            "question": data.query,
            "scope": data.model_dump(exclude={"authorized"}),
            "evidence": evidence,
            "claims": claims,
            "answer_reason": str(result.get("reason") or "")[:1000]
            if data.cloud and evidence and isinstance(result, dict)
            else "",
            "status": status,
            "message": "找到相关原文，请核对是否支持你的问题。未找到反对意见不代表不存在。"
            if evidence
            else "当前文献中没有足够依据。",
        }
        return store.save("answers", value, 0)

    @app.get("/api/v1/answers")
    def answers():
        results = store.all("answers")
        for answer in results:
            missing = False
            stale = False
            for e in answer["evidence"]:
                try:
                    stale |= store.get("sources", e["source_id"])["revision"] != e["source_revision"]
                except FileNotFoundError:
                    missing = True
            answer["stale"] = stale or missing
            answer["source_deleted"] = missing
            if missing:
                answer["message"] = "原文献已删除；历史问答保留，无法再回到原件核对。"
        return results

    @app.get("/api/v1/jobs")
    def job_list():
        return jobs.list()

    @app.post("/api/v1/jobs/{ident}/cancel")
    def cancel(ident: str):
        return jobs.cancel(ident)

    @app.post("/api/v1/jobs/{ident}/retry")
    def retry(ident: str):
        job = next((j for j in jobs.list() if j["id"] == ident), None)
        if not job or job["stage"] not in ("parse", "classify"):
            raise ValueError("此任务不能自动重试；云端请求需重新核对用量及授权")
        return {"job_id": jobs.submit(job["source_id"], job["stage"])}

    @app.get("/api/v1/provider")
    def provider_status():
        return provider.public()

    @app.post("/api/v1/provider")
    def provider_config(data: ProviderInput):
        with store.lock:
            return provider.configure(data.model_dump())

    @app.post("/api/v1/provider/test")
    def provider_test():
        return provider.test_connection()

    @app.get("/api/v1/usage")
    def usage():
        return provider.usage()

    @app.post("/api/v1/exports")
    def export():
        path = export_library(store)
        return {"name": path.name, "path": str(path)}

    @app.post("/api/v1/imports/validate")
    def validate(data: dict):
        return validate_backup(data["path"])

    @app.post("/api/v1/imports/restore")
    def restore(data: dict):
        return restore_backup(data["path"], data["destination"])

    return app
