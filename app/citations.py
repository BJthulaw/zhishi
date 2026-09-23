"""Versioned draft citations. Handbook rules remain subject to human verification."""

REQUIRED = {
    "journal": ["authors", "journal", "year", "issue", "pages", "cited_page"],
    "book": ["authors", "publisher", "year", "edition", "cited_page"],
    "web": ["authors", "website", "date", "url", "accessed"],
    "law": ["authority", "number", "date", "provision", "url", "legal_status"],
    "case": ["authority", "number", "date", "provision", "url"],
    "excerpt": ["parent_source", "locator"],
}


def citation(source):
    b = source.get("bibliography", {})
    kind = b.get("type", "excerpt")
    missing = [f for f in REQUIRED.get(kind, REQUIRED["excerpt"]) if not b.get(f)]
    title = source["title"]
    author = b.get("authors") or "〔作者待补〕"
    if kind == "journal":
        text = f"{author}：《{title}》，《{b.get('journal') or '刊名待补'}》{b.get('year') or '年份待补'}年第{b.get('issue') or '期号待补'}期，第{b.get('cited_page') or '引证页待补'}页。"
    elif kind == "book":
        text = f"{author}：《{title}》，{b.get('publisher') or '出版社待补'}{b.get('year') or '年份待补'}年版，第{b.get('cited_page') or '引证页待补'}页。"
    elif kind == "web":
        text = f"{author}：《{title}》，{b.get('website') or '网站待补'}，{b.get('date') or '发布日期待补'}，{b.get('url') or '网址待补'}，访问日期：{b.get('accessed') or '待补'}。"
    elif kind in ("law", "case"):
        text = f"{b.get('authority') or '主体待补'}：《{title}》（{b.get('number') or '文号/案号待补'}），{b.get('date') or '日期待补'}，{b.get('provision') or '条款/段落待补'}。"
    else:
        text = f"《{title}》，来源：{b.get('parent_source') or '母文献待补'}，位置：{b.get('locator') or '待补'}。"
    return {
        "draft": text,
        "missing_fields": missing,
        "verified": False,
        "template_version": "legal-draft-1",
        "notice": "引注草稿：请核对《法学引注手册》及投稿要求；PDF文件页序不代表印刷页码。",
    }
