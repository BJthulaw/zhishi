"""Hash-verified portable backups. Restore always targets a new empty directory."""

import json
from contextlib import closing
import sqlite3
import zipfile
from pathlib import Path, PurePosixPath
from .store import atomic, digest, json_bytes, uid, SCHEMA


def export_library(store):
    with store.lock:
        destination = store.root / "exports" / f"zhishi-{uid()}.zip"
        snapshot = store.root / "staging" / f"{uid()}.sqlite"
        with store.operations() as source, closing(sqlite3.connect(snapshot)) as target:
            source.backup(target)
        files = {}
        for folder in ("objects", "originals", "assets"):
            for path in (store.root / folder).rglob("*"):
                if path.is_file() and not path.name.endswith(".tmp"):
                    files[path.relative_to(store.root).as_posix()] = path
        files["library.json"] = store.root / "library.json"
        files["runtime/operations.sqlite"] = snapshot
        manifest = {"schema": SCHEMA, "files": {name: digest(path.read_bytes()) for name, path in files.items()}}
        with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, path in files.items():
                archive.write(path, name)
            archive.writestr("manifest.json", json_bytes(manifest))
        snapshot.unlink(missing_ok=True)
        return destination


def validate_backup(path):
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if len(entries) > 100000 or sum(e.file_size for e in entries) > 20 * 1024**3:
            raise ValueError("备份包超过验证限制")
        names = [e.filename for e in entries]
        if len(names) != len(set(names)):
            raise ValueError("备份包含重复路径")
        for name in names:
            pure = PurePosixPath(name)
            if pure.is_absolute() or ".." in pure.parts or "\\" in name or ":" in name:
                raise ValueError("备份包含不安全路径")
            if name != "manifest.json" and pure.parts[0] not in (
                "objects",
                "originals",
                "assets",
                "runtime",
                "library.json",
            ):
                raise ValueError("备份包含不允许的文件")
        manifest = json.loads(archive.read("manifest.json"))
        if manifest["schema"] != SCHEMA or set(names) != set(manifest["files"]) | {"manifest.json"}:
            raise ValueError("备份清单或版本不匹配")
        for name, hashed in manifest["files"].items():
            if digest(archive.read(name)) != hashed:
                raise ValueError("备份文件校验失败：" + name)
        for name in names:
            if name.startswith("objects/") and name.endswith("/current.json"):
                pointer = json.loads(archive.read(name))
                version = str(PurePosixPath(name).parent / f"{pointer['revision']}.json")
                if version not in names:
                    raise ValueError("修订引用不存在")
                obj = json.loads(archive.read(version))
                if obj.get("schema_version") != SCHEMA:
                    raise ValueError("对象版本不兼容")
                if name.startswith("objects/sources/"):
                    if obj["original"] not in names or digest(archive.read(obj["original"])) != obj["hash"]:
                        raise ValueError("文献原件引用或指纹不一致")
                if (
                    name.startswith("objects/notes/")
                    and f"objects/sources/{obj['source_id']}/current.json" not in names
                ):
                    raise ValueError("笔记关联文献不存在")
        for name in names:
            if name.startswith("objects/answers/") and not name.endswith("/current.json"):
                answer = json.loads(archive.read(name))
                evidence_ids = {e["id"] for e in answer.get("evidence", [])}
                for evidence in answer.get("evidence", []):
                    version = f"objects/sources/{evidence['source_id']}/{evidence['source_revision']}.json"
                    if version not in names:
                        raise ValueError("回答关联的来源修订不存在")
                    source = json.loads(archive.read(version))
                    block = next((b for b in source.get("blocks", []) if b["id"] == evidence["block_id"]), None)
                    if not block or evidence["quote"] not in block["raw"] or evidence["locator"] != block["locator"]:
                        raise ValueError("回答证据与原文不一致")
                if any(c["evidence_id"] not in evidence_ids for c in answer.get("claims", [])):
                    raise ValueError("回答缺少关联证据")
        return {"valid": True, "files": len(manifest["files"]), "schema": SCHEMA}


def restore_backup(path, destination):
    report = validate_backup(path)
    destination = Path(destination).resolve()
    if destination.exists() and any(destination.iterdir()):
        raise ValueError("恢复目标必须是新建空目录，不覆盖已有资料")
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path) as archive:
        for name in archive.namelist():
            if name == "manifest.json":
                continue
            target = (destination / name).resolve()
            if not target.is_relative_to(destination):
                raise ValueError("路径越界")
            atomic(target, archive.read(name))
    return report
