from test_product import parsed_source


def test_highlights_persist_without_changing_evidence(client):
    s = parsed_source(client.app.state.store, "可核对的文献原文。", "标记测试")
    mark = dict(
        id="mark1",
        block_id=s["blocks"][0]["id"],
        parse_revision=s["parse_revision"],
        start=0,
        end=3,
        text="可核对",
        view="clean",
        style="purple",
    )
    url = f"/api/v1/sources/{s['id']}/highlights"
    response = client.patch(url, json=dict(expected_revision=s["revision"], highlights=[mark]))
    assert response.status_code == 200
    updated = client.get(f"/api/v1/sources/{s['id']}").json()
    assert updated["highlights"] == [mark]
    assert updated["blocks"] == s["blocks"]
    assert client.patch(url, json=dict(expected_revision=s["revision"], highlights=[])).status_code == 409
    assert client.patch(url, json=dict(expected_revision=updated["revision"], highlights=[])).json()["highlights"] == []


def test_highlights_reject_stale_or_invalid_ranges(client):
    s = parsed_source(client.app.state.store, "完整原文", "范围测试")
    mark = dict(
        id="mark1",
        block_id=s["blocks"][0]["id"],
        parse_revision=s["parse_revision"],
        start=0,
        end=2,
        text="完整",
        view="raw",
        style="bold",
    )
    url = f"/api/v1/sources/{s['id']}/highlights"
    for change in [
        dict(end=0),
        dict(start=5),
        dict(block_id="missing"),
        dict(parse_revision=999),
        dict(style="script"),
    ]:
        assert client.patch(
            url, json=dict(expected_revision=s["revision"], highlights=[{**mark, **change}])
        ).status_code in (400, 422)
