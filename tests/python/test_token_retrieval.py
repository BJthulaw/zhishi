import json
import httpx
from test_product import parsed_source


def test_price_configuration_removed_and_legacy_ignored(client):
    schema = client.app.openapi()
    fields = schema["components"]["schemas"]["ProviderInput"]["properties"]
    assert "input_per_million" not in fields and "request_budget" not in fields
    assert client.post("/api/v1/provider/prices", json={}).status_code == 404
    r = client.post(
        "/api/v1/provider",
        json={"base_url": "https://example.invalid/v1", "model": "mock", "input_per_million": 0, "daily_budget": 0},
    )
    assert r.status_code == 200
    assert "daily_budget" not in r.json()


def test_local_concepts_retrieve_english_without_model(client, monkeypatch):
    source = parsed_source(
        client.app.state.store,
        "Data federalism describes intergovernmental data exchange among public authorities.",
        "Data Federalism",
    )
    parsed_source(client.app.state.store, "Gardening involves soil and watering plants.", "Gardening")
    monkeypatch.setattr(
        httpx, "post", lambda *a, **k: (_ for _ in ()).throw(AssertionError("local search must not use network"))
    )
    result = client.post("/api/v1/answers", json={"query": "数据联邦主义是什么意思"}).json()
    assert result["status"] == "evidence_only" and result["claims"] == []
    assert result["evidence"][0]["source_id"] == source["id"]
    assert result["evidence"][0]["quote"] == source["blocks"][0]["raw"]
    assert client.get("/api/v1/usage").json() == []
    assert client.post("/api/v1/search", json={"query": "数据联邦主义", "source_ids": ["nonexistent"]}).json() == []


def test_model_answer_without_prices_has_validated_source(client, monkeypatch):
    source = parsed_source(
        client.app.state.store,
        "Data federalism describes intergovernmental data exchange among public authorities.",
        "Data Federalism",
    )
    provider = client.app.state.provider
    provider.configure(
        dict(base_url="https://example.invalid/v1", model="mock", key="fake", enabled=True, answers=True)
    )

    def respond(*args, **kwargs):
        payload = json.loads(kwargs["json"]["messages"][1]["content"])
        if "evidence" in payload:
            e = payload["evidence"][0]
            output = {
                "claims": [
                    {"text": "数据联邦主义涉及公共机构之间的数据交换。", "evidence_id": e["id"], "quote": e["quote"]}
                ]
            }
        else:
            output = {"supported_indices": [0]}
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": json.dumps(output)}}],
                "usage": {"prompt_tokens": 20, "completion_tokens": 10},
            },
            request=httpx.Request("POST", args[0]),
        )

    monkeypatch.setattr(httpx, "post", respond)
    result = client.post(
        "/api/v1/answers", json={"query": "数据联邦主义是什么意思", "cloud": True, "authorized": True}
    ).json()
    assert result["claims"][0]["text"].startswith("数据联邦主义")
    assert result["claims"][0]["evidence_id"] == result["evidence"][0]["id"]
    assert result["evidence"][0]["source_id"] == source["id"]
    usage = provider.usage()
    assert len(usage) == 1 and sum(r["total_tokens"] for r in usage) == 30
    assert all(r["estimated_input_tokens"] > 0 for r in usage)
