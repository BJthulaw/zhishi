from app.answer_support import original_quote
from test_product import parsed_source


def test_quote_resolves_pdf_line_breaks_without_inventing_text():
    assert original_quote("data exchange", "A data\n exchange example") == "data\n exchange"
    assert original_quote("数据共享", "数据 共享") == "数据 共享"
    assert original_quote("data sharing", "data exchange") is None
    assert original_quote(" ", "anything") is None


def test_answer_keeps_text_when_quote_only_has_layout_whitespace(client, monkeypatch):
    s=parsed_source(client.app.state.store, "Data federalism describes data exchange.", "Paper")
    block=s["blocks"][0]
    block["raw"]="Data federalism describes data\n exchange."
    s=client.app.state.store.save("sources",s,s["revision"])
    responses=iter([{"claims":[{"text":"这是公共机构的数据交换机制。","evidence_id":f"{s['id']}:1:{block['id']}","quote":"data exchange"}]},{"supported_indices":[0]}])
    monkeypatch.setattr(client.app.state.provider,"call",lambda *args:next(responses))
    r=client.post("/api/v1/answers",json={"query":"数据联邦主义", "cloud":True,"authorized":True}).json()
    assert r["claims"][0]["text"]
    assert r["claims"][0]["quote"] == "data\n exchange"


def test_topic_scope_any_and_all(client):
    store=client.app.state.store
    a=parsed_source(store,"个人信息保护需要知情同意。","A")
    b=parsed_source(store,"个人信息保护要求数据共享约束。","B")
    a["topic_ids"]=["personal_data_protection"]
    b["topic_ids"]=["personal_data_protection","data_circulation"]
    store.save("sources",a,a["revision"]);store.save("sources",b,b["revision"])
    common={"query":"个人信息保护", "topic_ids":["personal_data_protection","data_circulation"]}
    any_result=client.post("/api/v1/answers",json={**common,"topic_mode":"any"}).json()
    all_result=client.post("/api/v1/answers",json={**common,"topic_mode":"all"}).json()
    assert {e["source_id"] for e in any_result["evidence"]}=={a["id"],b["id"]}
    assert {e["source_id"] for e in all_result["evidence"]}=={b["id"]}
