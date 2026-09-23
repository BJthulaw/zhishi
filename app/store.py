"""Canonical immutable JSON revisions; SQLite projections and durable operations."""

import copy
from contextlib import contextmanager
import hashlib
import json
import os
import re
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from ulid import ULID
from .topics import TOPICS, IDS, terms
from .local_search import query_terms, concept_score

SCHEMA = 1


def now():
    return datetime.now(timezone.utc).isoformat()


def uid():
    return str(ULID())


def digest(data):
    return hashlib.sha256(data).hexdigest()


def atomic(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + "." + uid() + ".tmp")
    with temp.open("wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, indent=2).encode("utf-8")


def read_json(path):
    """Windows 上原子替换时可能短暂拒绝读取，短重试后仍失败再抛出。"""
    path = Path(path)
    last = None
    for attempt in range(12):
        try:
            return json.loads(path.read_text("utf8"))
        except PermissionError as error:
            last = error
            time.sleep(0.05 * (attempt + 1))
    raise last


class Conflict(ValueError):
    pass


class Store:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.lock = threading.RLock()
        for folder in ("objects", "originals", "assets", "indexes", "runtime", "staging", "exports"):
            (self.root / folder).mkdir(parents=True, exist_ok=True)
        manifest = self.root / "library.json"
        if manifest.exists():
            if json.loads(manifest.read_text("utf8")).get("schema") != SCHEMA:
                raise ValueError("资料库版本不兼容，停止写入")
        else:
            atomic(manifest, json_bytes({"schema": SCHEMA, "id": uid(), "created_at": now()}))
        self._file_lock = (self.root / "runtime" / "writer.lock").open("a+b")
        self._file_lock.write(b"0")
        self._file_lock.flush()
        self._file_lock.seek(0)
        try:
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(self._file_lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(self._file_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self._file_lock.close()
            raise ValueError("此知识库已由另一个进程打开") from None
        with self.index() as db:
            db.executescript("""CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, hash TEXT, data TEXT);
                CREATE TABLE IF NOT EXISTS topics(source_id TEXT, topic_id TEXT, PRIMARY KEY(source_id,topic_id));
                CREATE VIRTUAL TABLE IF NOT EXISTS blocks USING fts5(source_id UNINDEXED,block_id UNINDEXED,tokens,raw UNINDEXED, tokenize='unicode61');""")
        with self.operations() as db:
            db.executescript("""CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, source_id TEXT, stage TEXT, state TEXT, error TEXT, created TEXT, updated TEXT);
                CREATE TABLE IF NOT EXISTS usage(id TEXT PRIMARY KEY, day TEXT, source_id TEXT, reserve REAL, actual REAL, state TEXT, cache_key TEXT, output TEXT);
                UPDATE jobs SET state='interrupted',error='上次运行中断，可安全重试本地解析' WHERE state IN ('running','queued');
                UPDATE usage SET state='usage_unknown' WHERE state='reserved';""")
            db.execute("""CREATE TABLE IF NOT EXISTS usage_details(
                id TEXT PRIMARY KEY, created TEXT, operation TEXT, model TEXT, endpoint TEXT,
                prompt_tokens INTEGER, completion_tokens INTEGER, total_tokens INTEGER)""")
            columns = {row[1] for row in db.execute("PRAGMA table_info(usage_details)")}
            if "currency" not in columns:
                db.execute("ALTER TABLE usage_details ADD COLUMN currency TEXT")
            for name in ("estimated_input_tokens", "estimated_output_tokens"):
                if name not in columns:
                    db.execute(f"ALTER TABLE usage_details ADD COLUMN {name} INTEGER")
        self.rebuild()

    @contextmanager
    def index(self):
        db = sqlite3.connect(self.root / "indexes" / "search.sqlite", timeout=30)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    @contextmanager
    def operations(self):
        db = sqlite3.connect(self.root / "runtime" / "operations.sqlite", timeout=30)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def close(self):
        if self._file_lock.closed:
            return
        if os.name == "nt":
            import msvcrt

            self._file_lock.seek(0)
            msvcrt.locking(self._file_lock.fileno(), msvcrt.LK_UNLCK, 1)
        self._file_lock.close()

    def object_path(self, kind, ident):
        if kind not in ("sources", "notes", "answers") or not re.fullmatch(r"[0-9A-HJKMNP-TV-Z]{26}", ident):
            raise ValueError("无效对象标识")
        return self.root / "objects" / kind / ident

    def get(self, kind, ident, revision=None):
        with self.lock:
            folder = self.object_path(kind, ident)
            if revision is None:
                revision = read_json(folder / "current.json")["revision"]
            if not isinstance(revision, int) or revision < 1:
                raise ValueError("无效修订号")
            return read_json(folder / f"{revision}.json")

    def all(self, kind):
        folder = self.root / "objects" / kind
        if not folder.exists():
            return []
        return [self.get(kind, p.parent.name) for p in folder.glob("*/current.json")]

    def save(self, kind, value, expected=None):
        with self.lock:
            value = copy.deepcopy(value)
            folder = self.object_path(kind, value["id"])
            current = self.get(kind, value["id"]) if (folder / "current.json").exists() else None
            actual = current["revision"] if current else 0
            if expected is not None and expected != actual:
                raise Conflict("记录已更新，请刷新后重试；你的编辑尚未覆盖现有内容")
            value.update(revision=actual + 1, schema_version=SCHEMA, updated_at=now())
            value.setdefault("created_at", now())
            atomic(folder / f"{actual + 1}.json", json_bytes(value))
            atomic(folder / "current.json", json_bytes({"revision": actual + 1}))
            if kind == "sources":
                try:
                    self.project(value)
                    value["index_status"] = "ready"
                except sqlite3.Error:
                    value["index_status"] = "pending"
            return value

    def project(self, source):
        with self.index() as db:
            brief = {k: v for k, v in source.items() if k != "blocks"}
            db.execute(
                "INSERT OR REPLACE INTO sources VALUES(?,?,?)",
                (source["id"], source["hash"], json.dumps(brief, ensure_ascii=False)),
            )
            db.execute("DELETE FROM topics WHERE source_id=?", (source["id"],))
            db.executemany("INSERT INTO topics VALUES(?,?)", [(source["id"], t) for t in source.get("topic_ids", [])])
            db.execute("DELETE FROM blocks WHERE source_id=?", (source["id"],))
            db.executemany(
                "INSERT INTO blocks VALUES(?,?,?,?)",
                [
                    (source["id"], b["id"], " ".join(terms(b.get("raw", ""))), b.get("raw", ""))
                    for b in source.get("blocks", [])
                    if b.get("raw")
                ],
            )

    def rebuild(self):
        with self.lock:
            with self.index() as db:
                db.executescript("DELETE FROM sources; DELETE FROM topics; DELETE FROM blocks;")
            for source in self.all("sources"):
                self.project(source)

    def list_sources(self, query="", topic_ids=(), topic_mode="any", kind="", pending=False, offset=0, limit=50):
        with self.index() as db:
            rows = db.execute("SELECT data FROM sources").fetchall()
        result = []
        matching = None
        if query:
            matching = {e["source_id"] for e in self.search(query, limit=10000)}
        for row in rows:
            source = json.loads(row[0])
            selected = set(source.get("topic_ids", []))
            if topic_ids and not (set(topic_ids) <= selected if topic_mode == "all" else set(topic_ids) & selected):
                continue
            if kind and source["kind"] != kind:
                continue
            if pending and not self.pending(source):
                continue
            if (
                query
                and source["id"] not in matching
                and query.lower() not in (source["title"] + " " + " ".join(source.get("tags", []))).lower()
            ):
                continue
            result.append(source)
        result.sort(key=lambda s: s["created_at"], reverse=True)
        return {"items": result[offset : offset + limit], "total": len(result)}

    @staticmethod
    def pending(source):
        return (
            source.get("parse_status") != "succeeded"
            or not source.get("topic_ids")
            or not source.get("bibliography", {}).get("authors")
        )

    def search(self, query, topic_ids=(), topic_mode="any", source_ids=(), limit=20):
        tokens, concepts = query_terms(query)
        if not tokens:
            return []
        match = " OR ".join('"' + t.replace('"', '""') + '"' for t in tokens)
        with self.index() as db:
            rows = db.execute(
                "SELECT source_id,block_id,raw,bm25(blocks) score FROM blocks WHERE blocks MATCH ? ORDER BY score LIMIT 10000",
                (match,),
            ).fetchall()
        result, source_cache = [], {}
        qset = set(tokens)
        for row in rows:
            sid = row["source_id"]
            if source_ids and sid not in source_ids:
                continue
            if sid not in source_cache:
                source_cache[sid] = self.get("sources", sid)
            source = source_cache[sid]
            selected = set(source.get("topic_ids", []))
            if topic_ids and not (set(topic_ids) <= selected if topic_mode == "all" else selected & set(topic_ids)):
                continue
            overlap = qset & set(terms(row["raw"]))
            semantic = concept_score(row["raw"], concepts)
            if not semantic and len(overlap) < min(2, len(qset)):
                continue
            block = next((b for b in source.get("blocks", []) if b["id"] == row["block_id"]), None)
            if not block or (block.get("ocr_method") and not block.get("verified")):
                continue
            result.append(
                {
                    "id": f"{sid}:{source.get('parse_revision', 0)}:{block['id']}",
                    "source_id": sid,
                    "source_revision": source["revision"],
                    "parse_revision": source.get("parse_revision", 0),
                    "block_id": block["id"],
                    "title": source["title"],
                    "quote": block["raw"],
                    "locator": block["locator"],
                    "score": semantic * 2 + len(overlap) / len(qset) + (-row["score"]) / (1 + abs(row["score"])),
                    "retrieval_method": "local_concept_bm25",
                    "bibliography": source.get("bibliography", {}),
                }
            )
        result.sort(key=lambda e: e["score"], reverse=True)
        return result[:limit]

    def ingest(self, data, filename, title="", url=""):
        hashed = digest(data)
        with self.lock:
            with self.index() as db:
                existing = db.execute("SELECT id FROM sources WHERE hash=?", (hashed,)).fetchone()
            if existing:
                return self.get("sources", existing[0]), True
            ident = uid()
            kind = Path(filename).suffix.lower().lstrip(".") or "txt"
            original = f"originals/{ident}.{kind}"
            atomic(self.root / original, data)
            source = {
                "id": ident,
                "title": title.strip() or Path(filename).stem,
                "title_origin": "manual" if title.strip() else "filename",
                "filename": Path(filename).name,
                "kind": kind,
                "hash": hashed,
                "original": original,
                "url": url,
                "archive_status": "saved",
                "parse_status": "queued",
                "semantic_status": "not_requested",
                "parse_revision": 0,
                "topic_ids": [],
                "primary_topic_id": None,
                "confirmed": False,
                "topic_history": [],
                "tags": [],
                "bibliography": {"type": "web" if url else "excerpt", "url": url, "accessed": now()[:10]},
                "blocks": [],
                "summary": {},
                "warnings": [],
            }
            return self.save("sources", source, 0), False

    def delete_source(self, ident):
        import shutil

        with self.lock:
            source = self.get("sources", ident)
            targets = [self.object_path("sources", ident), self.root / source["original"], self.root / "assets" / ident]
            for target in targets:
                resolved = target.resolve()
                if not resolved.is_relative_to(self.root) or resolved == self.root:
                    raise ValueError("删除路径超出当前资料库")
            for target in targets:
                if target.is_dir():
                    shutil.rmtree(target)
                else:
                    target.unlink(missing_ok=True)
            with self.index() as db:
                for table in ("sources", "topics", "blocks"):
                    db.execute(f"DELETE FROM {table} WHERE {'id' if table == 'sources' else 'source_id'}=?", (ident,))
            with self.operations() as db:
                db.execute("DELETE FROM jobs WHERE source_id=?", (ident,))
            return {"deleted": True, "id": ident}

    def set_topics(self, ident, data):
        with self.lock:
            source = self.get("sources", ident)
            topics = list(dict.fromkeys(data["topic_ids"]))
            if set(topics) - IDS or (data.get("primary_topic_id") and data["primary_topic_id"] not in topics):
                raise ValueError("主题无效，主主题必须属于所选集合")
            if "other" in topics and len(topics) > 1 and not data.get("allow_other_mix"):
                raise ValueError("其它与具体主题同时选择，请先确认冲突")
            source["topic_history"].append({k: source.get(k) for k in ("topic_ids", "primary_topic_id", "confirmed")})
            source.update(topic_ids=topics, primary_topic_id=data.get("primary_topic_id"), confirmed=data["confirmed"])
            return self.save("sources", source, data["expected_revision"])

    def undo_topics(self, ident, expected):
        with self.lock:
            source = self.get("sources", ident)
            if not source["topic_history"]:
                raise ValueError("没有可撤销的分类修改")
            source.update(source["topic_history"].pop())
            return self.save("sources", source, expected)

    def topics(self):
        with self.index() as db:
            counts = dict(db.execute("SELECT topic_id,count(*) FROM topics GROUP BY topic_id").fetchall())
        scopes = json.loads((Path(__file__).parent / "topic-scopes.json").read_text("utf8"))
        return [
            {"id": tid, "name": name, "scope": scopes.get(name, scope.replace("|", "、")), "count": counts.get(tid, 0)}
            for tid, name, scope in TOPICS
        ]

    def save_note(self, data):
        source = self.get("sources", data["source_id"])
        if data.get("block_id"):
            block = next((b for b in source["blocks"] if b["id"] == data["block_id"]), None)
            if not block or data.get("quote", "") not in block["raw"]:
                raise ValueError("摘录不属于指定原文区块")
        elif data.get("quote"):
            raise ValueError("摘录需要原文区块定位")
        value = {**data, "id": data.get("id") or uid(), "parse_revision": source["parse_revision"]}
        return self.save("notes", value, data.get("expected_revision") if data.get("id") else 0)
