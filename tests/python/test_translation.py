import pytest
from app.translation import translate, prose
from app.topics import summarize
from test_product import parsed_source


class Model:
    settings = {"model": "test"}

    def __init__(self):
        self.calls = []

    def call(self, operation, source, payload, authorized):
        assert authorized and operation == "translation"
        self.calls.append(payload)
        return {"translations": [{"id": x["id"], "text": "中文译文"} for x in payload["segments"]]}


def test_translation_alignment_and_bounded_batches():
    source = {
        "id": "s",
        "parse_revision": 2,
        "blocks": [
            {"id": "b1", "type": "text", "raw": "First paragraph. " * 600},
            {"id": "b2", "type": "text", "raw": "Second paragraph."},
        ],
    }
    model = Model()
    result = translate(source, model, True, lambda: False, lambda *args: None)
    assert result["parse_revision"] == 2
    assert [p["block_id"] for p in result["paragraphs"]] == ["b1", "b2"]
    assert len(model.calls) > 1
    assert all(sum(len(s["text"]) for s in call["segments"]) <= 4000 for call in model.calls)
    assert source["blocks"][1]["raw"] == "Second paragraph."


def test_translation_missing_ids_and_cancellation():
    source = {"id": "s", "parse_revision": 1, "blocks": [{"id": "b", "type": "text", "raw": "Original."}]}
    model = Model()
    model.call = lambda *args: {"translations": []}
    with pytest.raises(ValueError):
        translate(source, model, True, lambda: False, lambda *a: None)
    with pytest.raises(InterruptedError):
        translate(source, model, True, lambda: True, lambda *a: None)


def test_summary_prose_removes_layout_breaks():
    assert prose("data pro-\ntection and\n rights") == "data protection and rights"
    assert prose("数据产\n权登记") == "数据产权登记"
    result = summarize(
        [
            {
                "id": "b",
                "type": "text",
                "raw": "This article examines the legal protection of personal\n information and its important consequences for individuals.",
            }
        ],
        {},
    )
    assert "\n" not in result["text"]
    assert "personal information" in result["text"]


def test_manual_title_and_per_style_citations_persist(client):
    s = parsed_source(client.app.state.store, "Original evidence.", "Wrong title")
    b = {**s["bibliography"], "citation_legal": "人工法学引注", "citation_apa": "Manual APA"}
    result = client.patch(
        f"/api/v1/sources/{s['id']}",
        json=dict(expected_revision=s["revision"], title="Correct title", bibliography=b, tags=[], keywords=[]),
    )
    assert result.status_code == 200
    saved = client.get(f"/api/v1/sources/{s['id']}").json()
    assert saved["title_origin"] == "manual" and saved["title"] == "Correct title"
    assert saved["bibliography"]["citation_apa"] == "Manual APA"
    assert saved["blocks"] == s["blocks"]


def test_translation_requires_opt_in(client):
    provider = client.app.state.provider
    provider.configure(dict(base_url="https://example.invalid/v1", model="m", key="fake", enabled=True))
    with pytest.raises(ValueError, match="未授权"):
        provider.call("translation", "s", {}, True)


def test_checkpoint_failure_resume_skips_saved_units():
    from copy import deepcopy

    source = {
        "id": "resume",
        "parse_revision": 3,
        "blocks": [{"id": f"b{i}", "type": "text", "raw": ("Paragraph " + str(i) + " ") * 130} for i in range(4)],
    }
    model = Model()
    original = model.call
    calls = []
    saved = []

    def flaky(*args):
        calls.append(args[2]["segments"])
        if len(calls) == 2:
            raise RuntimeError("connection failed")
        return original(*args)

    model.call = flaky
    with pytest.raises(RuntimeError):
        translate(source, model, True, lambda: False, lambda *a: None, lambda value: saved.append(deepcopy(value)))
    partial = saved[-1]
    assert 0 < partial["completed"] < partial["total"]
    assert any(p["text"] for p in partial["paragraphs"])
    source["translation"] = partial
    resumed = Model()
    result = translate(source, resumed, True, lambda: False, lambda *a: None)
    completed_ids = {s["id"] for s in partial["segments"]}
    assert not completed_ids.intersection(s["id"] for c in resumed.calls for s in c["segments"])
    assert result["status"] == "complete"
    source["translation"] = result
    no_calls = Model()
    assert translate(source, no_calls, True, lambda: False, lambda *a: None)["status"] == "complete"
    assert no_calls.calls == []


def test_legacy_complete_translation_reused_and_reparse_invalidates():
    source = {
        "id": "old",
        "parse_revision": 1,
        "blocks": [{"id": "b", "type": "text", "raw": "Original."}],
        "translation": {
            "parse_revision": 1,
            "model": "old-model",
            "paragraphs": [{"block_id": "b", "original": "Original.", "text": "原文译文"}],
        },
    }
    model = Model()
    result = translate(source, model, True, lambda: False, lambda *a: None)
    assert model.calls == [] and result["paragraphs"][0]["text"] == "原文译文"
    source["parse_revision"] = 2
    translate(source, model, True, lambda: False, lambda *a: None)
    assert len(model.calls) == 1


def test_cancel_after_batch_keeps_checkpoint():
    source = {
        "id": "cancel",
        "parse_revision": 1,
        "blocks": [{"id": "b", "type": "text", "raw": "A paragraph. " * 600}],
    }
    saved = []
    with pytest.raises(InterruptedError):
        translate(
            source,
            Model(),
            True,
            lambda: bool(saved and saved[-1]["completed"]),
            lambda *a: None,
            lambda value: saved.append(value),
        )
    assert saved[-1]["completed"] > 0
    assert saved[-1]["paragraphs"][0]["text"]
