import json
import time
import httpx
import pytest
from app.contracts import ProviderInput
from app.store import uid


def settings(client, **extra):
    value = ProviderInput(
        base_url="https://example.invalid/v1",
        model="test",
        key="fake",
        enabled=True,
        summary=True,
        ocr=True,
        input_per_million=1,
        output_per_million=1,
        request_budget=10,
        daily_budget=100,
    ).model_dump()
    value.update(extra)
    client.app.state.provider.configure(value)
    return value


def mock_post(monkeypatch, callback):
    def post(url, **kwargs):
        output = callback(kwargs["json"])
        return httpx.Response(
            200,
            request=httpx.Request("POST", url),
            json={
                "choices": [{"message": {"content": json.dumps(output, ensure_ascii=False)}}],
                "usage": {"prompt_tokens": 12, "completion_tokens": 8, "total_tokens": 20},
            },
        )

    monkeypatch.setattr(httpx, "post", post)


def test_connection_really_infers_and_accounts_without_price(client, monkeypatch):
    settings(client, enabled=False, input_per_million=0, output_per_million=0)

    def reply(body):
        assert body["model"] == "test" and body["max_tokens"] == 32
        assert "blocks" not in body["messages"][1]["content"]
        return {"ok": True}

    mock_post(monkeypatch, reply)
    assert client.post("/api/v1/provider/test").json()["connected"]
    row = client.get("/api/v1/usage").json()[0]
    assert row["operation"] == "connection" and row["total_tokens"] == 20
    assert "actual" not in row and row["estimated_output_tokens"] == 32


def test_connection_rejects_wrong_protocol(client, monkeypatch):
    settings(client)
    mock_post(monkeypatch, lambda body: {"wrong": True})
    assert client.post("/api/v1/provider/test").status_code == 400


def test_connection_auth_error_is_specific(client, monkeypatch):
    settings(client)
    monkeypatch.setattr(httpx, "post", lambda url, **kw: httpx.Response(401, request=httpx.Request("POST", url)))
    response = client.post("/api/v1/provider/test")
    assert response.status_code == 400 and "Key 无效" in response.json()["message"]
    assert "fake" not in response.text


def test_delete_keeps_notes_and_answers_and_original_download(client, tmp_path):
    store = client.app.state.store
    outside = tmp_path / "download.txt"
    outside.write_text("我的原文件", encoding="utf8")
    source, _ = store.ingest(outside.read_bytes(), "download.txt")
    note = store.save_note({"source_id": source["id"], "markdown": "保留笔记", "quote": ""})
    store.save(
        "answers",
        {
            "id": uid(),
            "evidence": [{"source_id": source["id"], "source_revision": source["revision"]}],
            "message": "旧回答",
        },
        0,
    )
    response = client.delete("/api/v1/sources/" + source["id"])
    assert response.json()["deleted"]
    assert outside.exists() and not (store.root / source["original"]).exists()
    assert client.get("/api/v1/sources/" + source["id"]).status_code == 404
    assert client.get("/api/v1/notes").json()[0]["source_deleted"]
    assert store.get("notes", note["id"])["markdown"] == "保留笔记"
    assert client.get("/api/v1/answers").json()[0]["source_deleted"]
    assert not store.list_sources()["items"]


def wait_job(client, ident):
    for _ in range(400):
        job = next(j for j in client.app.state.jobs.list() if j["id"] == ident)
        if job["state"] in ("succeeded", "failed", "cancelled"):
            return job
        time.sleep(0.03)
    pytest.fail("job timeout")


def test_summary_is_synthesized_not_quote_list(client, monkeypatch):
    settings(client)
    store = client.app.state.store
    source, _ = store.ingest(b"text", "paper.txt")
    source["blocks"] = [
        {
            "id": "b1",
            "type": "text",
            "raw": "数据产权登记应当区分事实证明、合规宣示与权利对抗。",
            "clean": "正文",
            "locator": {"paragraph": 1},
        }
    ]
    source["coverage"] = {"total": 1, "parsed": 1, "complete": True}
    source = store.save("sources", source, source["revision"])
    summary = (
        "本文围绕数据产权登记的制度设计展开研究，提出区分事实证明、合规宣示与权利对抗三种功能，避免将不同阶段和场景中的登记功能混为一谈。"
        * 4
    )

    def reply(body):
        payload = json.loads(body["messages"][1]["content"])
        if "blocks" in payload:
            return {"quotes": [{"block_id": "b1", "quote": source["blocks"][0]["raw"]}]}
        return {"summary": summary}

    mock_post(monkeypatch, reply)
    response = client.post(
        f"/api/v1/sources/{source['id']}/analyze",
        json={"stage": "summary", "cloud": True, "authorized": True, "destination": "https://example.invalid/v1"},
    )
    assert wait_job(client, response.json()["job_id"])["state"] == "succeeded"
    result = store.get("sources", source["id"])["summary"]
    assert result["mode"] == "model-summary" and 200 < len(result["text"]) < 400
    assert result["quotes"][0]["quote"] == source["blocks"][0]["raw"]


def test_cloud_requires_exact_destination_confirmation(client):
    settings(client)
    s, _ = client.app.state.store.ingest(b"x", "x.txt")
    assert (
        client.post(
            f"/api/v1/sources/{s['id']}/analyze",
            json={"stage": "llm_parse", "cloud": True, "authorized": True, "destination": "https://wrong.invalid"},
        ).status_code
        == 400
    )


def test_visual_parse_replaces_only_after_success_and_stays_unverified(client, monkeypatch):
    import pymupdf

    settings(client)
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((70, 70), "Example paper")
    store = client.app.state.store
    source, _ = store.ingest(doc.tobytes(), "example.pdf")
    doc.close()
    mock_post(
        monkeypatch,
        lambda body: {
            "paragraphs": ["模型恢复的完整段落。"],
            "printed_page": "55",
            "metadata": {"title": "完整论文标题", "authors": "某作者", "journal": "某期刊"},
        },
    )
    response = client.post(
        f"/api/v1/sources/{source['id']}/analyze",
        json={"stage": "llm_parse", "cloud": True, "authorized": True, "destination": "https://example.invalid/v1"},
    )
    assert wait_job(client, response.json()["job_id"])["state"] == "succeeded"
    result = store.get("sources", source["id"])
    assert result["parse_status"] == "needs_review" and result["blocks"][0]["verified"] is False
    assert result["blocks"][0]["locator"]["printed_page"] == "55"
    assert result["title"] == "完整论文标题" and (store.root / source["original"]).exists()


def test_model_failure_preserves_previous_blocks(client, monkeypatch):
    import pymupdf

    settings(client)
    doc = pymupdf.open()
    doc.new_page()
    store = client.app.state.store
    s, _ = store.ingest(doc.tobytes(), "old.pdf")
    doc.close()
    s["blocks"] = [{"id": "old", "type": "text", "raw": "已有正文", "clean": "已有正文", "locator": {"page_index": 0}}]
    s = store.save("sources", s, s["revision"])
    mock_post(monkeypatch, lambda body: {"paragraphs": []})
    job = client.app.state.jobs.submit(s["id"], "llm_parse", True, True)
    assert wait_job(client, job)["state"] == "failed"
    assert store.get("sources", s["id"])["blocks"] == s["blocks"]


def test_delete_refuses_outside_library(client, tmp_path):
    store = client.app.state.store
    s, _ = store.ingest(b"x", "safe.txt")
    outside = tmp_path / "keep.txt"
    outside.write_text("keep")
    s["original"] = str(outside)
    store.save("sources", s, s["revision"])
    assert client.delete("/api/v1/sources/" + s["id"]).status_code == 400
    assert outside.read_text() == "keep"


def test_old_pdf_upgrades_locally_once(tmp_path):
    import pymupdf
    from app.store import Store
    from app.provider import Provider
    from app.jobs import Jobs

    doc = pymupdf.open()
    p = doc.new_page()
    p.insert_text((60, 70), "Complete title for this paper", fontsize=20)
    store = Store(tmp_path / "library")
    s, _ = store.ingest(doc.tobytes(), "old.pdf")
    doc.close()
    s.update(
        title="Incomplete",
        title_origin="extracted",
        parse_status="succeeded",
        summary={"mode": "manual", "text": "用户手写摘要"},
    )
    store.save("sources", s, s["revision"])
    jobs = Jobs(store, Provider(store))
    try:
        for future in list(jobs.futures.values()):
            future.result(timeout=30)
        current = store.get("sources", s["id"])
        assert current["title"] == "Complete title for this paper"
        assert current["parser_version"] == "0.1.5"
        assert current["summary"]["text"] == "用户手写摘要"
        assert jobs.list()[0]["state"] == "succeeded"
    finally:
        jobs.shutdown()
        store.close()


def test_visual_job_keeps_confirmed_destination(client, monkeypatch):
    import pymupdf
    initial = settings(client)
    doc = pymupdf.open()
    doc.new_page()
    doc.new_page()
    store = client.app.state.store
    source, _ = store.ingest(doc.tobytes(), "two-pages.pdf")
    doc.close()
    calls = []
    def post(url, **kwargs):
        calls.append(url)
        client.app.state.provider.configure({**initial, "base_url":"https://changed.invalid/v1"})
        return httpx.Response(200,request=httpx.Request("POST",url),json={
            "choices":[{"message":{"content":json.dumps({"paragraphs":["测试页面内容"],"printed_page":str(len(calls))})}}],
            "usage":{"prompt_tokens":10,"completion_tokens":10}})
    monkeypatch.setattr(httpx,"post",post)
    ident=client.app.state.jobs.submit(source["id"],"llm_parse",True,True)
    assert wait_job(client,ident)["state"] == "succeeded"
    assert calls == ["https://example.invalid/v1/chat/completions"] * 2
