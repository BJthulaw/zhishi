"""对照 PRD A15–A21 的摘要优先分类规则。"""

from app.topics import TOPICS, classify, clean_text, summarize


def test_ten_topics_match_prd_order_and_names():
    names = [item[1] for item in TOPICS]
    assert names == [
        "个人信息保护",
        "数据流通利用",
        "网络内容治理",
        "人工智能（算法）治理",
        "平台市场秩序",
        "网络系统安全",
        "网络空间国际治理",
        "新技术新业态治理",
        "法律科技创新",
        "其它",
    ]


def test_classify_uses_summary_not_title_keywords():
    summary = {
        "text": "本文研究公共数据授权运营的合同结构与企业数据入表问题。",
        "coverage": {"complete": True},
        "version": "t",
    }
    result = classify(summary)
    assert "data_circulation" in result["topic_ids"]
    assert result["primary_topic_id"] == "data_circulation"
    assert "personal_data_protection" not in result["topic_ids"]


def test_multi_topic_when_summary_supports_both():
    summary = {
        "text": "自动化决策对个人画像、合法性基础和解释保障的影响，同时涉及算法公平与算法可问责。",
        "coverage": {"complete": True},
        "version": "t",
    }
    result = classify(summary)
    assert "personal_data_protection" in result["topic_ids"]
    assert "ai_algorithm_governance" in result["topic_ids"]


def test_missing_summary_goes_to_review_not_other():
    result = classify({"text": "", "coverage": {"complete": False}})
    assert result["status"] == "needs_review"
    assert result["topic_ids"] == []
    assert result["primary_topic_id"] is None


def test_unrelated_complete_summary_is_other():
    summary = {
        "text": "本文讨论宋代瓷器窑口鉴定与釉色实验方法，与数字治理无关。",
        "coverage": {"complete": True},
        "version": "t",
    }
    result = classify(summary)
    assert result["topic_ids"] == ["other"]


def test_incomplete_parse_does_not_auto_assign():
    summary = {
        "text": "个人信息保护法中的知情同意与删除权。",
        "coverage": {"complete": False},
        "version": "t",
    }
    result = classify(summary)
    assert result["status"] == "needs_review"
    assert result["topic_ids"] == []


def test_clean_text_joins_cjk_soft_wrap_only():
    raw = "知情\n同意是合法性基础。\n\n- 列表项"
    assert "知情同意" in clean_text(raw)
    assert "- 列表项" in clean_text(raw)


def test_summarize_keeps_original_sentences():
    blocks = [
        {
            "id": "b1",
            "raw": "知情同意是个人信息处理的合法性基础之一。删除权保障个人对其信息的控制。",
        }
    ]
    summary = summarize(blocks, {"complete": True, "parsed": 1, "total": 1})
    assert summary["mode"] == "extractive"
    assert "不是语义综述" in summary["label"]
    assert "知情同意" in summary["text"]
    assert "b1" in summary["evidence_ids"]
