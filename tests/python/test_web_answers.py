import socket
import pytest
from app.network import resolve_public, public_dns
from app.answer_support import linked_claims
from app.parsers import parse_file


def test_fake_dns_uses_verified_public_addresses(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: [(2, 1, 6, "", ("198.18.0.94", 443))])
    monkeypatch.setattr("app.network.public_dns", lambda host: ["8.8.8.8"])
    assert resolve_public("https://www.nda.gov.cn/a")[1] == "8.8.8.8"
    with pytest.raises(ValueError):
        resolve_public("http://198.18.0.94/a")
    monkeypatch.setattr("app.network.public_dns", lambda host: ["127.0.0.1"])
    with pytest.raises(ValueError):
        resolve_public("https://example.com/a")


def test_private_resolution_never_uses_public_fallback(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: [(2, 1, 6, "", ("192.168.1.1", 443))])
    monkeypatch.setattr(
        "app.network.public_dns", lambda host: (_ for _ in ()).throw(AssertionError("must not fallback"))
    )
    with pytest.raises(ValueError):
        resolve_public("https://internal.test/a")


def test_public_dns_rejects_private_answers(monkeypatch):
    import httpx

    monkeypatch.setattr(
        httpx,
        "get",
        lambda *a, **k: httpx.Response(
            200,
            json={"Status": 0, "Answer": [{"type": 1, "data": "10.0.0.1"}]},
            request=httpx.Request("GET", "https://dns.google/resolve"),
        ),
    )
    with pytest.raises(ValueError):
        public_dns("example.com")


def test_web_body_and_official_metadata(tmp_path):
    p = tmp_path / "web.html"
    paragraphs = [
        "这是测试网页的正文第一段，讨论数据产权与数据共享的重要关系。" * 5,
        "这是测试网页的正文第二段，介绍数据登记与合法流通的基本要求。" * 5,
    ]
    p.write_text(
        '<html><head><meta charset="UTF-8"><meta name="ArticleTitle" content="测试文章标题"><meta name="ContentSource" content="测试发布机关"><meta name="PubDate" content="2026.09.19"></head><body><article><h1>测试文章标题</h1>'
        + "".join("<p>" + v + "</p>" for v in paragraphs)
        + "</article></body></html>",
        encoding="utf-8",
    )
    r = parse_file(p, "url")
    text = "\n".join(b["raw"] for b in r["blocks"])
    assert all(v in text for v in paragraphs)
    assert r["metadata"]["title"] == "测试文章标题"
    assert r["metadata"]["authors"] == "测试发布机关"
    assert len(r["blocks"]) >= 2


def test_interpretation_needs_sources_not_mandatory_verbatim_quote():
    evidence = [{"id": "s:1:b1", "quote": "This is original evidence."}, {"id": "s:1:b2", "quote": "A second source."}]
    claims = linked_claims({"claims": [{"text": "依据两项材料的中文解释。", "evidence_ids": ["E1", "E2"]}]}, evidence)
    assert claims[0]["text"] and claims[0]["quote"] == ""
    assert claims[0]["evidence_ids"] == ["s:1:b1", "s:1:b2"]
    assert claims[0]["review"] == "source_linked_pending_human"
    assert linked_claims({"claims": [{"text": "无来源事实", "evidence_ids": ["E99"]}]}, evidence) == []
    claims = linked_claims(
        {"claims": [{"text": "有来源解释", "evidence_ids": ["E1"], "quote": "fabricated quote"}]}, evidence
    )
    assert claims[0]["quote"] == ""


def test_dns_service_failure_uses_second_fixed_resolver(monkeypatch):
    import httpx

    calls = []

    def fetch(url, **kwargs):
        calls.append(url)
        if len(calls) == 1:
            raise httpx.ConnectTimeout("timeout")
        return httpx.Response(
            200, json={"Status": 0, "Answer": [{"type": 1, "data": "8.8.8.8"}]}, request=httpx.Request("GET", url)
        )

    monkeypatch.setattr(httpx, "get", fetch)
    assert public_dns("example.com") == ["8.8.8.8"]
    assert calls == ["https://dns.alidns.com/resolve", "https://dns.google/resolve"]


def test_web_retries_only_validated_cdn_addresses(monkeypatch):
    from app.network import fetch_public
    from urllib.parse import urlsplit
    import http.client

    calls = []

    class Connection:
        def __init__(self, *a, **k):
            pass

        def request(self, *a, **k):
            pass

        def getresponse(self):
            return self

        status = 200

        def getheader(self, *a):
            return "text/html"

        def read(self, *a):
            return b"<article>complete body</article>"

        def close(self):
            pass

    def connect(address, **kwargs):
        calls.append(address[0])
        if len(calls) == 1:
            raise TimeoutError("first CDN unavailable")
        return object()

    monkeypatch.setattr("app.network.resolve_public_addresses", lambda u: (urlsplit(u), ["1.1.1.1", "8.8.8.8"], 80))
    monkeypatch.setattr(socket, "create_connection", connect)
    monkeypatch.setattr(http.client, "HTTPConnection", Connection)
    assert fetch_public("http://public.example/article")[0].startswith(b"<article>")
    assert calls == ["1.1.1.1", "8.8.8.8"]
