"""Offline concept-expanded BM25 retrieval. No remote service or generative model."""

import re
from .topics import terms

# Curated domain concepts connect common Chinese questions to original English text.
CONCEPTS = (
    ("数据联邦主义", "数据联邦制", "data federalism", "intergovernmental data exchange"),
    ("数据封建主义", "数据封建制", "数字农奴", "data feudalism", "digital serfs"),
    ("个人信息", "个人数据", "personal information", "personal data"),
    ("删除权", "被遗忘权", "right to erasure", "right to be forgotten"),
    ("数据可携带权", "数据携带权", "data portability"),
    ("知情同意", "用户同意", "informed consent"),
    ("未成年人", "儿童", "青少年", "children", "minors"),
    ("自动化决策", "自动决策", "automated decision"),
    ("算法公平", "算法歧视", "algorithmic fairness", "algorithmic discrimination"),
    ("数据产权", "数据所有权", "data ownership", "data property"),
    ("数据共享", "数据交换", "data sharing", "data exchange"),
    ("人工智能", "artificial intelligence"),
    ("隐私影响评估", "个人信息保护影响评估", "privacy impact assessment"),
)


def normalized(text):
    return re.sub(r"\s+", " ", text.lower()).strip()


def query_terms(query):
    cleaned = re.sub(r"是什么意思|是什么|什么是|请解释|请问|如何理解|的含义|what is|explain", " ", normalized(query))
    matched = [group for group in CONCEPTS if any(alias in cleaned for alias in group)]
    expanded = cleaned + " " + " ".join(alias for group in matched for alias in group)
    return list(dict.fromkeys(terms(expanded)))[:240], matched


def concept_score(text, matched):
    text = normalized(text)
    return sum(any(alias in text for alias in group) for group in matched) / max(1, len(matched))
