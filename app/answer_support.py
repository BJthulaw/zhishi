"""Resolve harmless PDF whitespace differences to an exact original excerpt."""

import re


def original_quote(quote, raw):
    if not isinstance(quote, str) or not quote.strip():
        return None
    if quote in raw:
        return quote
    compact = []
    positions = []
    for index, char in enumerate(raw):
        if not char.isspace():
            compact.append(char)
            positions.append(index)
    needle = re.sub(r"\s+", "", quote)
    if not needle:
        return None
    start = "".join(compact).find(needle)
    if start < 0:
        return None
    return raw[positions[start] : positions[start + len(needle) - 1] + 1]


def answer_payload(question, evidence):
    return {
        "question": question,
        "task": '请用中文直接回答研究问题。依据材料解释概念、归纳制度、比较观点，形成有内容的段落，不要只抄摘录。每段必须关联支撑它的来源编号，不能虚构材料外的事实。解释与归纳不要求原文逐字出现；quote 可省略，仅在直接引用时填写原句。返回 {"claims":[{"text":"一段中文解答","evidence_ids":["E1"],"quote":"可选原句"}],"reason":"若确实无法回答，说明具体缺少何种材料"}。',
        "evidence": [{**e, "id": f"E{i + 1}"} for i, e in enumerate(evidence)],
    }


def linked_claims(result, evidence):
    if not isinstance(result, dict):
        raise ValueError("模型回答格式无效，请检查模型兼容性")
    mapping = {e["id"]: e for e in evidence}
    mapping.update({f"E{i + 1}": e for i, e in enumerate(evidence)})
    items = result.get("claims", result.get("paragraphs", []))
    if not items and isinstance(result.get("answer"), str):
        items = [{"text": result["answer"], "evidence_ids": result.get("evidence_ids", result.get("citations", []))}]
    claims = []
    if not isinstance(items, list):
        raise ValueError("模型回答段落格式无效")
    for item in items[:30]:
        if not isinstance(item, dict) or not isinstance(item.get("text"), str) or not item["text"].strip():
            continue
        refs = item.get("evidence_ids", item.get("citations", [item.get("evidence_id")]))
        if not isinstance(refs, list):
            refs = [refs]
        entries = []
        for ref in refs:
            key = str(ref).strip("[] ")
            if key.isdigit():
                key = "E" + key
            entry = mapping.get(key)
            if not entry:
                entries = []
                break
            if entry not in entries:
                entries.append(entry)
        if not entries:
            continue
        quote = original_quote(item.get("quote"), entries[0]["quote"])
        claims.append(
            {
                "text": item["text"].strip()[:6000],
                "evidence_id": entries[0]["id"],
                "evidence_ids": [e["id"] for e in entries],
                "quote": quote or "",
                "kind": "model_interpretation",
                "review": "source_linked_pending_human",
            }
        )
    return claims
