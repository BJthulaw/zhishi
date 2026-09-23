import json
import httpx
import pytest


def config():
    return dict(
        base_url="https://example.invalid/v1",
        model="test-model",
        key="fake-key",
        enabled=True,
        summary=True,
        answers=True,
        input_per_million=2,
        output_per_million=4,
        request_budget=1,
        daily_budget=10,
    )


@pytest.mark.parametrize(
    "reported,expected",
    [
        ({"prompt_tokens": 12, "completion_tokens": 8}, 20),
        (None, None),
        ({"prompt_tokens": -1, "completion_tokens": 8}, None),
    ],
)
def test_usage_tokens_cache_and_missing(client, monkeypatch, reported, expected):
    p = client.app.state.provider
    p.configure(config())
    monkeypatch.setattr(
        httpx,
        "post",
        lambda *a, **kw: httpx.Response(
            200,
            json={"choices": [{"message": {"content": "{}"}}], "usage": reported},
            request=httpx.Request("POST", "https://example.invalid"),
        ),
    )
    p.call("answers", "source", {"q": "test"}, True)
    row = client.get("/api/v1/usage").json()[0]
    assert row["total_tokens"] == expected
    assert row["operation"] == "answers" and row["model"] == "test-model" and row["created"]
    assert "fake-key" not in json.dumps(row)
    assert "output" not in row and "cache_key" not in row
    assert row["estimated_input_tokens"] > 0 and row["estimated_output_tokens"] == 3000
    assert "actual" not in row and "reserve" not in row
    assert row["state"] == "settled"
    p.call("answers", "source", {"q": "test"}, True)
    assert len(p.usage()) == 1


def test_old_records_not_truncated_or_invented(client):
    store = client.app.state.store
    with store.operations() as db:
        for i in range(105):
            db.execute(
                "INSERT INTO usage VALUES(?,?,?,?,?,?,?,?)",
                (str(i), "2026-09-19", "s", 0.1, None, "usage_unknown", str(i), None),
            )
    rows = client.get("/api/v1/usage").json()
    assert len(rows) == 105 and all(r["total_tokens"] is None for r in rows)


def test_invalid_output_keeps_reported_tokens(client, monkeypatch):
    p = client.app.state.provider
    p.configure(config())
    monkeypatch.setattr(
        httpx,
        "post",
        lambda *a, **kw: httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "not json"}}],
                "usage": {"prompt_tokens": 3, "completion_tokens": 2},
            },
            request=httpx.Request("POST", "https://example.invalid"),
        ),
    )
    with pytest.raises(ValueError):
        p.call("summary", "source", {}, True)
    assert p.usage()[0]["total_tokens"] == 5
    assert p.usage()[0]["state"] == "usage_unknown"
