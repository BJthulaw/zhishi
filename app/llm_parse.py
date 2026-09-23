"""Explicitly authorized visual parsing; model text remains unverified evidence."""

import base64
import re


def parse_with_model(source, store, provider, authorized, cancelled):
    if not authorized or not provider.settings.get("ocr") or not provider.settings.get("enabled"):
        raise ValueError("请启用云端模型和图像识别，并确认发送地址")
    if source["kind"] != "pdf":
        raise ValueError("LLM 逐页替换目前支持 PDF；图片请使用图像识别")
    import pymupdf

    blocks, metadata = [], {}
    with pymupdf.open(store.root / source["original"]) as doc:
        if doc.needs_pass or len(doc) > 100:
            raise ValueError("请先解密 PDF；模型解析单次最多100页")
        for index, page in enumerate(doc):
            if cancelled():
                raise InterruptedError("已取消模型解析，原结果保留")
            pix = page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5), alpha=False)
            result = provider.call(
                "ocr",
                source["id"],
                {
                    "task": '按图片实际阅读顺序完整转录本页，合并版面软换行、保留真实段落与小节。保留脚注；不总结、不改写、不补造。印刷页码只读页脚或页眉数字，不能使用文件页序。首页提取完整标题、作者；其他页仅补充本论文页眉页脚的期刊、年份、卷期，禁止取参考文献的来源。返回 JSON {"paragraphs":["段落"],"printed_page":"数字或空字符串","metadata":{"title":"","authors":"","journal":"","year":"","volume":"","issue":""}}。',
                    "page_index": index,
                    "images": [base64.b64encode(pix.tobytes("png")).decode()],
                    "output_limit": 6000,
                },
                authorized,
            )
            paragraphs = result.get("paragraphs")
            if (
                not isinstance(paragraphs, list)
                or not paragraphs
                or any(not isinstance(t, str) or len(t) > 30000 for t in paragraphs)
            ):
                raise ValueError(f"文件第{index + 1}页模型结果无效，未替换原结果")
            text_length = sum(len(t.strip()) for t in paragraphs)
            native_length = len(re.sub(r"\s", "", page.get_text()))
            if text_length < 1 or (native_length > 300 and text_length < native_length * 0.55):
                raise ValueError(f"文件第{index + 1}页疑似漏识别，未替换原结果")
            printed = str(result.get("printed_page", ""))
            printed = printed if re.fullmatch(r"\d{1,5}", printed) else None
            for text in paragraphs:
                if text.strip():
                    blocks.append(
                        {
                            "id": f"llm-{index}-{len(blocks)}",
                            "type": "text",
                            "raw": text.strip(),
                            "clean": text.strip(),
                            "ocr_method": "vision-api",
                            "verified": False,
                            "locator": {"page_index": index, "printed_page": printed, "ocr": True},
                        }
                    )
            candidate = result.get("metadata", {})
            if isinstance(candidate, dict):
                for key in ("title", "authors", "journal", "year", "volume", "issue"):
                    value = candidate.get(key)
                    if key in ("title", "authors") and index != 0:
                        continue
                    if isinstance(value, str) and 0 < len(value.strip()) < 300:
                        metadata.setdefault(key, value.strip())
        if metadata.get("journal"):
            metadata["type"] = "journal"
        pages = list(dict.fromkeys(b["locator"]["printed_page"] for b in blocks))
        if len(pages) == len(doc) and all(pages) and all(int(n) == int(pages[0]) + i for i, n in enumerate(pages)):
            metadata["pages"] = f"{pages[0]}-{pages[-1]}"
        return {
            "blocks": blocks,
            "metadata": metadata,
            "coverage": {
                "total": len(doc),
                "parsed": 0,
                "complete": False,
                "unit": "页",
                "ocr_pages": list(range(len(doc))),
            },
        }
