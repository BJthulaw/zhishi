"""Public URL snapshots with DNS-pinned connections and bounded downloads."""

import http.client
import ipaddress
import socket
import ssl
from urllib.parse import urlsplit, urljoin

MAX_WEB = 8 * 1024 * 1024
FAKE_IP = ipaddress.ip_network("198.18.0.0/15")


def public_dns(hostname):
    """Resolve proxy Fake-IP through a fixed HTTPS public DNS service."""
    import httpx

    result = None
    for resolver in ("https://dns.alidns.com/resolve", "https://dns.google/resolve"):
        try:
            result = httpx.get(resolver, params={"name": hostname, "type": "A"}, timeout=10, follow_redirects=False)
            result.raise_for_status()
            break
        except httpx.HTTPError:
            result = None
    if result is None:
        raise ValueError("公共 DNS 核验服务连接失败，请检查网络代理或稍后重新解析")
    payload = result.json()
    addresses = sorted({r["data"] for r in payload.get("Answer", []) if r.get("type") == 1})
    if payload.get("Status") != 0 or not addresses or any(not ipaddress.ip_address(a).is_global for a in addresses):
        raise ValueError("公共 DNS 无法核验此域名的公网地址")
    return addresses


def resolve_public_addresses(url):
    parsed = urlsplit(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("只允许不含凭据的公开 HTTP/HTTPS 地址")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    addresses = sorted({item[4][0] for item in socket.getaddrinfo(parsed.hostname, port, type=socket.SOCK_STREAM)})
    try:
        ipaddress.ip_address(parsed.hostname)
        literal = True
    except ValueError:
        literal = False
    if not literal and addresses and all(ipaddress.ip_address(a) in FAKE_IP for a in addresses):
        addresses = public_dns(parsed.hostname)
    if not addresses or any(not ipaddress.ip_address(addr).is_global for addr in addresses):
        raise ValueError("网页抓取禁止访问回环、内网、链路本地或保留地址")
    return parsed, addresses, port


def resolve_public(url):
    parsed, addresses, port = resolve_public_addresses(url)
    return parsed, addresses[0], port


def fetch_public(url):
    for _ in range(6):
        parsed, addresses, port = resolve_public_addresses(url)
        redirected = False
        for address in addresses[:3]:
            conn = http.client.HTTPConnection(parsed.hostname, port, timeout=15)
            try:
                sock = socket.create_connection((address, port), timeout=12)
                conn.sock = sock
                if parsed.scheme == "https":
                    conn.sock = ssl.create_default_context().wrap_socket(sock, server_hostname=parsed.hostname)
                path = parsed.path or "/"
                if parsed.query:
                    path += "?" + parsed.query
                conn.request(
                    "GET",
                    path,
                    headers={
                        "User-Agent": "Mozilla/5.0 (compatible; Zhishi literature archive)",
                        "Accept-Encoding": "identity",
                    },
                )
                response = conn.getresponse()
                if response.status in (301, 302, 303, 307, 308):
                    url = urljoin(url, response.getheader("Location", ""))
                    redirected = True
                    break
                if response.status != 200:
                    raise ValueError(f"网页返回 HTTP {response.status}，链接已保留，可粘贴正文")
                content_type = response.getheader("Content-Type", "")
                if not any(t in content_type.lower() for t in ("text/html", "text/plain", "application/xhtml")):
                    raise ValueError("当前链接不是静态网页；请下载文件后导入")
                body = response.read(MAX_WEB + 1)
                if len(body) > MAX_WEB:
                    raise ValueError("网页超过 8 MB 限制")
                return body, url
            except (OSError, http.client.HTTPException):
                # A public GET can retry another validated CDN address; model calls never do.
                continue
            finally:
                conn.close()
        if not redirected:
            raise ValueError("网页公网连接失败或超时，已尝试可用节点。可点击重新解析重试")
    raise ValueError("网页重定向次数过多")
