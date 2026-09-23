from .translation import prose

"""Summary-first rules: scores are evidence counts, never probabilities."""

import re
from collections import Counter

TOPICS = [
    (
        "personal_data_protection",
        "个人信息保护",
        "个人信息|GDPR|知情同意|隐私协议|删除权|被遗忘权|隐私影响评估|PIA|合法性基础|死者个人信息|敏感个人信息|已公开个人信息|个人画像|匿名化|去标识化|EDPB|隐私|个人权利|personal data|privacy|data protection|consent",
    ),
    (
        "data_circulation",
        "数据流通利用",
        "数据产权|数据共享|数据开放|数据交易|数据经纪人|数据商|可携带权|替代数据|公共数据授权运营|企业数据|数据融资|数据入股|数据产权登记|数据入账|数据入表|同意管理平台|数据受托|真实世界数据|科研数据|数据流通|data exchange|data sharing|data markets|data pools|data federalism|data ownership",
    ),
    (
        "online_content_governance",
        "网络内容治理",
        "虚假信息|选举信息|不良信息|违法信息|恐怖信息|色情信息|沉迷内容|年龄识别|青少年模式|内容生态|在线安全法|内容治理|未成年人网络保护|未成年人网络|未成年人保护|儿童网络|儿童保护|儿童法案|年龄验证|年龄核验|最低年龄|分级准入|EU KIDS|child safety|online safety|age verification|age assurance",
    ),
    (
        "ai_algorithm_governance",
        "人工智能（算法）治理",
        "人工智能法|自动化决策|算法公平|算法可问责|算法安全|算法治理|人工智能治理|模型资产化|算力|数据中心|数字鸿沟|人工智能素养",
    ),
    (
        "platform_market_order",
        "平台市场秩序",
        "平台治理|注意力经济|平台经济|垄断|不正当竞争|平台挖人|内卷式竞争|平台市场|monopoly|monopolies|oligopoly|gatekeepers|digital feudalism|data feudalism|tech giants|market power",
    ),
    (
        "network_system_security",
        "网络系统安全",
        "网络安全事件|网络安全|应急管理|网络犯罪|黑客攻击|数据泄露|网络安全认证|等级保护|应急处置",
    ),
    (
        "cyberspace_international",
        "网络空间国际治理",
        "国际组织|跨国会议|共同立场|国际治理|网络空间国际|联合国|跨境治理",
    ),
    ("new_tech_business", "新技术新业态治理", "数字货币|自动驾驶|智慧医疗|NFT|比特币|新业态|新技术治理"),
    (
        "legal_tech_innovation",
        "法律科技创新",
        "司法人工智能|法律实践|法律研究|法律教学|法律大模型|法律数据集|法律知识图谱|智能体开发|AI编程|向量数据库|提示词工程|coze|cursor|工作效率|交叉学科|人才培养|法院|检索增强智能体",
    ),
    ("other", "其它", ""),
]
IDS = {t[0] for t in TOPICS}


def terms(text):
    text = text.lower()
    chinese = re.findall(r"[\u4e00-\u9fff]+", text)
    return re.findall(r"[a-z0-9]{2,}", text) + [s[i : i + 2] for s in chinese for i in range(max(1, len(s) - 1))]


def clean_text(raw):
    # Only join CJK soft wraps with no punctuation/list boundary. Raw remains untouched.
    return re.sub(r"(?<=[\u4e00-\u9fff])\n(?=[\u4e00-\u9fff])", "", raw.replace("\r\n", "\n"))


def summarize(blocks, coverage):
    candidates = []
    stop = set(
        "the and for that this with from have has are was were not but their they them into its of to in on as is be by it an or at we our you your can will would a data".split()
    )
    counts = Counter(t for t in terms(" ".join(b.get("raw", "") for b in blocks)) if t not in stop)
    for index, block in enumerate(blocks):
        if block.get("layout_role") == "margin":
            continue
        raw = block.get("raw", "")
        if block.get("type") == "table" and raw.strip():
            candidates.append((1.0, raw[:1000], block["id"]))
        english = len(re.findall(r"[A-Za-z]", raw)) > max(5, len(re.findall(r"[\u4e00-\u9fff]", raw)) * 2)
        pattern = r"[^.!?]+[.!?]?" if english else r"[^。！？\n]+[。！？]?"
        for match in re.finditer(pattern, raw):
            sentence = match.group().strip()
            if len(sentence) < 8 or sentence.startswith("="):
                continue
            if english and len(sentence.split()) < 12:
                continue
            score = sum(counts[t] for t in set(terms(sentence))) / max(1, len(sentence))
            # Introductory prose is more informative than short recurring footnotes.
            if english:
                score *= 1 + 1 / (1 + index / 12)
                if re.search(r"this article|we argue|I argue|this paper", sentence, re.I):
                    score *= 1.5
            candidates.append((score, sentence[:1000], block["id"]))
    selected = sorted(candidates, reverse=True)[:12]
    # Preserve opening abstract/argument paragraphs rather than letting recurring
    # citation vocabulary dominate a long English law review article.
    opening = []
    for block in blocks:
        raw = block.get("raw", "").strip()
        if (
            block.get("layout_role") != "margin"
            and block.get("locator", {}).get("page_index", 99) <= 1
            and len(raw.split()) >= 45
            and len(re.findall(r"[A-Za-z]", raw)) > len(raw) * 0.5
            and not re.match(r"^\d", raw)
            and "...." not in raw
        ):
            opening.append((0, raw[:1000], block["id"]))
    if opening:
        prefix = opening[:4]
        selected = prefix + [item for item in selected if item[2] not in {p[2] for p in prefix}][:8]
    return {
        "mode": "extractive",
        "classification_text": "\n".join(x[1] for x in selected),
        "display_text": prose(" ".join(dict.fromkeys(x[1] for x in selected))),
        "text": prose(" ".join(dict.fromkeys(x[1] for x in selected))),
        "evidence_ids": list(dict.fromkeys(x[2] for x in selected)),
        "keywords": [x[0] for x in counts.most_common(10)],
        "coverage": coverage,
        "label": "抽取式阅读线索，不是语义综述",
        "version": "extractive-2",
    }


def classify(summary, confirmed_samples=()):
    content = (
        summary.get("classification_text", summary.get("text", ""))
        if summary.get("mode") == "extractive" and summary.get("text") == summary.get("display_text")
        else summary.get("text", "")
    ).strip()
    content = re.sub(r"(?<=[A-Za-z])-\s*\n\s*(?=[a-z])", "", content)
    content = re.sub(r"(?<=[A-Za-z,;]) *\n *(?=[A-Za-z])", " ", content)
    complete = summary.get("coverage", {}).get("complete", False)
    if not content:
        return {
            "topic_ids": [],
            "primary_topic_id": None,
            "status": "needs_review",
            "candidates": [],
            "reason": "摘要缺失",
        }
    candidates = []
    for tid, name, keywords in TOPICS[:-1]:
        matches = [w for w in keywords.split("|") if w.lower() in content.lower()]
        # Matches must occur in a substantive sentence, not an explicit background aside.
        evidence = [
            sentence
            for sentence in re.split(r"[。\n]", content)
            if any(w.lower() in sentence.lower() for w in matches)
            and not re.match(r"^(?:背景|仅以|以.*为背景|顺带|偶然提及)", sentence.strip())
        ]
        if evidence:
            candidates.append({"id": tid, "name": name, "score": len(matches), "reason": "；".join(evidence)[:400]})
    # Confirmed examples are deduplicated by original hash. Counts never amplify a category.
    seen = set()
    own = set(terms(content))
    references = []
    for sample in confirmed_samples:
        if sample["hash"] in seen:
            continue
        seen.add(sample["hash"])
        other = set(terms(sample.get("summary", {}).get("text", "")))
        similarity = len(own & other) / max(1, len(own | other))
        if similarity >= 0.65:
            references.append({"source_id": sample["id"], "similarity": round(similarity, 3)})
    # A single close confirmed example can contribute; duplicate counts cannot.
    sample_by_id = {sample["id"]: sample for sample in confirmed_samples}
    for reference in references:
        sample = sample_by_id[reference["source_id"]]
        if reference["similarity"] < 0.85:
            continue
        for topic_id in sample.get("topic_ids", []):
            if topic_id not in IDS or topic_id == "other" or any(c["id"] == topic_id for c in candidates):
                continue
            name = next(t[1] for t in TOPICS if t[0] == topic_id)
            candidates.append(
                {
                    "id": topic_id,
                    "name": name,
                    "score": 2.5 * reference["similarity"],
                    "reason": "与已确认摘要高度相近：" + sample["summary"]["text"][:260],
                    "reference_source_id": sample["id"],
                }
            )
    candidates.sort(key=lambda c: c["score"], reverse=True)
    selected = [c["id"] for c in candidates if c["score"] >= 2 or len(c["reason"]) >= 20]
    if not candidates and complete:
        selected = ["other"]
    return {
        "topic_ids": selected if complete else [],
        "primary_topic_id": selected[0] if selected and complete else None,
        "status": "suggested" if selected and complete else "needs_review",
        "candidates": candidates,
        "reason": "摘要规则候选，建议核对" if candidates else "摘要与九个具体主题无明显关联",
        "references": references,
        "method": "summary-rules-1",
        "summary_version": summary.get("version"),
    }
