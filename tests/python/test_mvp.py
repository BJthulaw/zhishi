"""收录、去重、笔记、检索、问答与鉴权（PRD A01/A02/A09/A11/A14）。"""

from __future__ import annotations

import time

from app.citations import citation
from app.parsers import parse_file


def _wait_parse(client, source_id: str, timeout: float = 20) -> dict:
    deadline = time.time() + timeout
    last_error = None
    while time.time() < deadline:
        try:
            source = client.get(f"/api/v1/sources/{source_id}").json()
            if source.get("parse_status") in {"succeeded", "needs_ocr", "failed"}:
                return source
        except PermissionError as error:
            last_error = error
        time.sleep(0.2)
    raise AssertionError(f"解析超时: {last_error}")


def test_health_requires_token(library):
    from fastapi.testclient import TestClient
    from app.api import create_app

    app = create_app(library / "other", "b" * 32)
    bare = TestClient(app)
    response = bare.get("/api/v1/health")
    assert response.status_code == 401


def test_health_ok(client):
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["api_version"] == 1


def test_ingest_text_archives_then_parses(client):
    first = client.post(
        "/api/v1/ingest/text", json={"text": "知情同意是合法性基础。删除权可以请求删除个人信息。", "title": "摘录一"}
    )
    assert first.status_code == 200
    data = first.json()
    assert data["archived"] is True
    assert data["duplicate"] is False
    source = client.get(f"/api/v1/sources/{data['source_id']}").json()
    assert source["archive_status"] == "saved"
    parsed = _wait_parse(client, data["source_id"])
    assert parsed["parse_status"] == "succeeded"
    assert any("知情同意" in b["raw"] for b in parsed["blocks"])
    assert parsed["semantic_status"] == "local_only"


def test_duplicate_hash_keeps_original(client):
    payload = {"text": "同一段不会写两份原件。", "title": "重复"}
    a = client.post("/api/v1/ingest/text", json=payload).json()
    b = client.post("/api/v1/ingest/text", json=payload).json()
    assert b["duplicate"] is True
    assert b["source_id"] == a["source_id"]
    assert b["job_id"] is None


def test_note_must_quote_raw_block(client):
    ingested = client.post(
        "/api/v1/ingest/text",
        json={"text": "个人有权请求删除个人信息。这是删除权条款。", "title": "笔记样本"},
    ).json()
    source = _wait_parse(client, ingested["source_id"])
    block = source["blocks"][0]
    ok = client.post(
        "/api/v1/notes",
        json={
            "source_id": source["id"],
            "block_id": block["id"],
            "quote": block["raw"][:8],
            "markdown": "需要核对法条原文。",
        },
    )
    assert ok.status_code == 200
    bad = client.post(
        "/api/v1/notes",
        json={
            "source_id": source["id"],
            "block_id": block["id"],
            "quote": "这段话并不在原文中",
            "markdown": "无效摘录",
        },
    )
    assert bad.status_code == 400


def test_search_short_chinese_terms(client):
    ingested = client.post(
        "/api/v1/ingest/text",
        json={"text": "隐私协议应当说明知情同意的范围。隐私政策不得捆绑。", "title": "短词检索"},
    ).json()
    _wait_parse(client, ingested["source_id"])
    hits = client.post("/api/v1/search", json={"query": "隐私"}).json()
    assert hits, "短词「隐私」应能召回"
    assert any("隐私" in item["quote"] for item in hits)


def test_answer_without_evidence(client):
    result = client.post("/api/v1/answers", json={"query": "火星民法典第1条怎么规定"}).json()
    assert result["status"] == "insufficient"
    assert "没有足够依据" in result["message"]
    assert result["claims"] == []


def test_citation_marks_missing_fields():
    source = {
        "title": "生成式人工智能训练数据的合理使用",
        "bibliography": {"type": "journal", "year": "2024"},
    }
    draft = citation(source)
    assert "authors" in draft["missing_fields"]
    assert draft["verified"] is False
    assert "待补" in draft["draft"] or "作者待补" in draft["draft"]


def test_parse_xlsx_keeps_formula_and_cached(tmp_path):
    from openpyxl import Workbook

    path = tmp_path / "sheet.xlsx"
    book = Workbook()
    sheet = book.active
    sheet.title = "对照"
    sheet["A1"] = "项目"
    sheet["B1"] = "数值"
    sheet["A2"] = "合计"
    sheet["B2"] = "=1+1"
    book.save(path)
    parsed = parse_file(path, "xlsx")
    assert parsed["blocks"]
    table = next(b for b in parsed["blocks"] if b["type"] == "table")
    formula_cells = [c for c in table["cells"] if c["formula"]]
    assert formula_cells
    assert formula_cells[0]["cached"] is False or formula_cells[0]["formula"].startswith("=")


def test_parse_pdf_keeps_page_index(tmp_path):
    import pymupdf

    path = tmp_path / "sample.pdf"
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), "知情同意是合法性基础。", fontname="china-s", fontsize=12)
    doc.save(path)
    doc.close()
    parsed = parse_file(path, "pdf")
    text_blocks = [b for b in parsed["blocks"] if b.get("raw")]
    assert text_blocks
    assert text_blocks[0]["locator"]["page_index"] == 0
    assert text_blocks[0]["locator"]["printed_page"] is None
    assert "知情同意" in text_blocks[0]["raw"]


def test_manual_topics_not_overwritten_by_reclassify(client):
    ingested = client.post(
        "/api/v1/ingest/text",
        json={"text": "本文讨论宋代瓷器鉴定方法。与数字治理无关。", "title": "人工覆盖"},
    ).json()
    source = _wait_parse(client, ingested["source_id"])
    patched = client.patch(
        f"/api/v1/sources/{source['id']}/topics",
        json={
            "expected_revision": source["revision"],
            "topic_ids": ["legal_tech_innovation"],
            "primary_topic_id": "legal_tech_innovation",
            "confirmed": True,
        },
    )
    assert patched.status_code == 200
    confirmed = patched.json()
    client.post(f"/api/v1/sources/{source['id']}/analyze", json={"stage": "classify"})
    time.sleep(0.8)
    again = client.get(f"/api/v1/sources/{source['id']}").json()
    assert again["topic_ids"] == ["legal_tech_innovation"]
    assert again["confirmed"] is True


def test_ssrf_blocked():
    from app.network import resolve_public
    import pytest

    with pytest.raises(ValueError):
        resolve_public("http://127.0.0.1/secret")
