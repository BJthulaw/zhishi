"""Isolated parser entry: returns JSON-serializable blocks, never edits the library."""

import base64
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree
from .topics import clean_text
from .pdf_layout import cjk_items, printed_page

MAX_CELLS = 200000
MAX_IMAGES = 30 * 1024 * 1024


def clean_pdf_text(raw):
    """Repair typographic line wrapping only; immutable raw retains source quotes."""
    import unicodedata

    if raw.strip().upper() == "SECTION TITLE":
        return ""

    text = unicodedata.normalize("NFKC", raw).replace("\r\n", "\n")
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u200b\ufeff\ufffd]", "", text)
    text = re.sub(r"[.·_]{4,}", " ", text)
    text = re.sub(r"(?<=[A-Za-z])-\s*\n\s*(?=[a-z])", "", text)
    text = re.sub(r"(?<=[\u4e00-\u9fff]) *\n *(?=[\u4e00-\u9fff])", "", text)
    text = re.sub(r"(?<=[、。，；：！？,;:!?）)》】]) *\n *(?=[\u4e00-\u9fff])", "", text)
    # A PDF text block is a paragraph, not a sequence of fixed-width lines.
    text = re.sub(r"[ \t]*\n[ \t]*(?!\n)", " ", text)
    return re.sub(r"[ \t]+", " ", text).strip()


def pdf_title(page):
    candidates = []
    for block in page.get_text("dict")["blocks"]:
        if block["type"] != 0:
            continue
        spans = [s for line in block["lines"] for s in line["spans"] if s["text"].strip()]
        text = clean_pdf_text("\n".join("".join(s["text"] for s in line["spans"]) for line in block["lines"]))
        if (
            not 8 <= len(text) <= 250
            or len(text.split()) > 35
            or re.search(r"contents|section title|editor|message|copyright|all rights|^\d|\.{4}", text, re.I)
        ):
            continue
        if block["bbox"][1] > page.rect.height * 0.65:
            continue
        size = max((s["size"] for s in spans if len(s["text"].strip()) >= 3), default=0)
        candidates.append((size, -block["bbox"][1], text))
    if not candidates:
        return ""
    best = max(candidates)
    # Chinese titles frequently use one PDF drawing block per title line.
    if re.search(r"[\u4e00-\u9fff]", best[2]):
        title_lines = []
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                spans = [s for s in line["spans"] if s["size"] >= best[0] * 0.9]
                text = "".join(s["text"] for s in spans).strip().rstrip("*†‡ ")
                if text and abs(line["bbox"][1] + best[1]) < best[0] * 3:
                    title_lines.append((line["bbox"][1], text))
        if title_lines:
            return re.sub(r"\s+", "", "".join(t for _, t in sorted(title_lines)))
    return best[2]


def inspect_zip(path):
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if len(entries) > 20000 or sum(e.file_size for e in entries) > 250 * 1024 * 1024:
            raise ValueError("压缩文档解压体积超限，原件已保存")
        if any(e.flag_bits & 1 for e in entries):
            raise ValueError("加密文档需解密后重新导入")


def parse_file(path, kind):
    path = Path(path)
    blocks, assets, warnings = [], {}, []
    coverage = {"total": 1, "parsed": 1, "complete": True, "unit": "文档", "ocr_pages": []}
    metadata = {}

    def add(raw="", locator=None, type="text", **extra):
        block = {
            "id": f"b{len(blocks) + 1:06d}",
            "type": type,
            "raw": raw,
            "clean": clean_text(raw),
            "locator": locator or {"paragraph": len(blocks) + 1},
            **extra,
        }
        blocks.append(block)
        return block

    def asset(data, ext):
        if sum(len(v["data"]) * 3 // 4 for v in assets.values()) + len(data) > MAX_IMAGES:
            warnings.append("部分图片超出提取上限，请回看原件")
            coverage["complete"] = False
            return None
        ext = ext.lower().replace("jpeg", "jpg")
        if ext not in ("png", "jpg", "webp", "gif"):
            warnings.append("无法安全预览的嵌入图像请回看原件")
            return None
        name = f"image-{len(assets) + 1}.{ext}"
        assets[name] = {"data": base64.b64encode(data).decode(), "ext": ext}
        return name

    if kind == "pdf":
        import pymupdf

        with pymupdf.open(path) as document:
            if document.needs_pass:
                raise ValueError("PDF 已加密；请解密后导入，原件已保留")
            coverage.update(total=len(document), parsed=0, unit="页")
            metadata = {
                "title": pdf_title(document[0]) or document.metadata.get("title") or "",
                "authors": document.metadata.get("author") or "",
            }
            for index, page in enumerate(document):
                if index >= 1000:
                    coverage["complete"] = False
                    warnings.append("超过 1000 页解析上限")
                    break
                page_start = len(blocks)
                loc = {
                    "page_index": index,
                    "printed_page": printed_page(page),
                    "width": page.rect.width,
                    "height": page.rect.height,
                    "rotation": page.rotation,
                }
                text_found = False
                for item in cjk_items(page):
                    if item["type"] == 0:
                        raw = "\n".join("".join(s["text"] for s in line["spans"]) for line in item["lines"])
                        if raw.strip():
                            text_found = True
                            block = add(raw, {**loc, "bbox": list(item["bbox"])})
                            display = "\n".join(
                                "".join(
                                    s["text"]
                                    for s in line["spans"]
                                    if not (s.get("flags", 0) & 1 and re.fullmatch(r"[\d*†‡]+", s["text"].strip()))
                                )
                                for line in item["lines"]
                            )
                            block["clean"] = clean_pdf_text(display)
                            block["layout_role"] = (
                                "margin"
                                if item["bbox"][3] < page.rect.height * 0.07
                                or item["bbox"][1] > page.rect.height * 0.93
                                or (raw.strip().isdigit() and item["bbox"][1] > page.rect.height * 0.85)
                                else "body"
                            )
                    elif item["type"] == 1:
                        name = asset(item["image"], item["ext"])
                        if name:
                            add(
                                "",
                                {**loc, "bbox": list(item["bbox"])},
                                "image",
                                asset=name,
                                decorative=(
                                    item["bbox"][2] - item["bbox"][0] < 28 and item["bbox"][3] - item["bbox"][1] < 28
                                ),
                            )
                try:
                    for table in page.find_tables().tables:
                        rows = table.extract()
                        add(
                            "\n".join("\t".join(c or "" for c in row) for row in rows),
                            {**loc, "bbox": list(table.bbox)},
                            "table",
                            rows=rows,
                        )
                except Exception:
                    warnings.append(f"第 {index + 1} 页表格结构未能提取，原页可查看")
                if index == 0:
                    page_blocks = blocks[page_start:]
                    title_index = next((i for i, b in enumerate(page_blocks) if b.get("clean") == metadata["title"]), 0)
                    blocks[page_start:] = page_blocks[title_index:] + page_blocks[:title_index]
                if text_found:
                    coverage["parsed"] += 1
                else:
                    coverage["ocr_pages"].append(index)
                    coverage["complete"] = False
            # Extract only explicit bibliographic evidence; never guess a journal or year.
            if re.search(r"[\u4e00-\u9fff]", metadata["title"]):
                first = document[0].get_text()
                date = re.search(r"(20\d{2}|19\d{2})\s*年第\s*(\d+)\s*期", first)
                if date:
                    metadata.update(year=date[1], issue=date[2])
                for item in document[0].get_text("dict")["blocks"]:
                    if not document[0].rect.height * 0.12 < item["bbox"][1] < document[0].rect.height * 0.45:
                        continue
                    text = "".join(s["text"] for l in item.get("lines", []) for s in l["spans"])
                    if re.fullmatch(r"[\u4e00-\u9fff][\u3000 ]*[\u4e00-\u9fff]{1,3}\s*\*{0,2}", text.strip()):
                        metadata["authors"] = re.sub(r"[\s*]", "", text)
                        break
                for p in list(document)[:2]:
                    for item in p.get_text("dict")["blocks"]:
                        if item["bbox"][1] <= p.rect.height * 0.9:
                            continue
                        for line in item.get("lines", []):
                            for span in line["spans"]:
                                text = span["text"].strip()
                                if re.fullmatch(r"[\u4e00-\u9fff]{2,16}(?:评论|学报|研究|杂志|论坛)", text):
                                    metadata.update(journal=text, type="journal")
                nums = [printed_page(p) for p in document]
                if all(nums) and all(int(n) == int(nums[0]) + i for i, n in enumerate(nums)):
                    metadata["pages"] = f"{nums[0]}-{nums[-1]}"
    elif kind == "docx":
        inspect_zip(path)
        from docx import Document
        from docx.text.paragraph import Paragraph
        from docx.table import Table

        document = Document(path)
        metadata = {"title": document.core_properties.title or "", "authors": document.core_properties.author or ""}
        heading = []
        for index, item in enumerate(document.element.body):
            locator = {"paragraph": index + 1, "heading_path": list(heading)}
            if item.tag.endswith("}p"):
                paragraph = Paragraph(item, document)
                if paragraph.style and paragraph.style.name.startswith("Heading"):
                    heading = [paragraph.text]
                if paragraph.text.strip():
                    add(paragraph.text, locator, heading=paragraph.style.name if paragraph.style else "")
                for blip in item.iter("{http://schemas.openxmlformats.org/drawingml/2006/main}blip"):
                    rel = blip.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed")
                    part = document.part.related_parts.get(rel)
                    if part:
                        name = asset(part.blob, str(part.partname).split(".")[-1])
                        if name:
                            add("", locator, "image", asset=name)
            elif item.tag.endswith("}tbl"):
                table = Table(item, document)
                rows = [[cell.text for cell in row.cells] for row in table.rows]
                add("\n".join("\t".join(row) for row in rows), locator, "table", rows=rows)
        with zipfile.ZipFile(path) as archive:
            if "word/footnotes.xml" in archive.namelist():
                root = ElementTree.fromstring(archive.read("word/footnotes.xml"))
                for note in root:
                    ident = note.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}id")
                    if ident and int(ident) > 0:
                        raw = "".join(
                            t.text or ""
                            for t in note.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t")
                        )
                        add(raw, {"footnote": ident}, "text", heading="脚注")
    elif kind == "xlsx":
        inspect_zip(path)
        from openpyxl import load_workbook

        values = load_workbook(path, data_only=True)
        formulas = load_workbook(path, data_only=False)
        try:
            total_cells = sum(s.max_row * s.max_column for s in formulas)
            if total_cells > MAX_CELLS:
                raise ValueError("表格超过 20 万单元格解析上限，原件已保留")
            for sheet in formulas:
                for start in range(1, sheet.max_row + 1, 50):
                    rows, cells = [], []
                    for row in sheet.iter_rows(min_row=start, max_row=min(start + 49, sheet.max_row)):
                        output = []
                        for cell in row:
                            cached = values[sheet.title][cell.coordinate].value
                            formula = str(cell.value) if cell.data_type == "f" else None
                            value = "" if cached is None else str(cached)
                            output.append(value if value else (f"{formula}（未计算）" if formula else ""))
                            if cell.value is not None:
                                cells.append(
                                    {
                                        "coordinate": cell.coordinate,
                                        "value": value,
                                        "formula": formula,
                                        "cached": cached is not None,
                                    }
                                )
                        rows.append(output)
                    if any(any(row) for row in rows):
                        add(
                            "\n".join("\t".join(row) for row in rows),
                            {"sheet": sheet.title, "range": f"A{start}:{row[-1].coordinate}"},
                            "table",
                            rows=rows,
                            cells=cells,
                            merged=[str(r) for r in sheet.merged_cells.ranges],
                        )
                for img in sheet._images:
                    name = asset(img._data(), img.format)
                    if name:
                        anchor = getattr(img.anchor, "_from", None)
                        add("", {"sheet": sheet.title, "row": anchor.row + 1 if anchor else None}, "image", asset=name)
        finally:
            values.close()
            formulas.close()
    elif kind in ("png", "jpg", "jpeg", "webp"):
        from PIL import Image

        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            add("", {"image": "original", "width": image.width, "height": image.height}, "image", asset="original")
        coverage.update(parsed=0, complete=False, ocr_pages=[0])
    elif kind in ("html", "url"):
        import trafilatura

        raw_html = path.read_bytes()
        content = trafilatura.extract(
            raw_html,
            include_tables=True,
            include_links=False,
            include_comments=False,
            favor_recall=True,
            output_format="txt",
        )
        if not content:
            raise ValueError("网页正文不可提取；可在文献中补充正文")
        meta = trafilatura.extract_metadata(raw_html)
        if meta:
            metadata = {"title": meta.title or "", "authors": meta.author or "", "date": meta.date or ""}
        from lxml import html

        tree = html.fromstring(raw_html)
        metas = {m.get("name", "").lower(): m.get("content", "").strip() for m in tree.xpath("//meta[@name][@content]")}
        metadata["title"] = metas.get("articletitle") or metadata.get("title", "")
        metadata["authors"] = metas.get("author") or metadata.get("authors") or metas.get("contentsource", "")
        metadata["date"] = metadata.get("date") or metas.get("pubdate", "").replace(".", "-")
        for n, text in enumerate(line for line in content.splitlines() if line.strip()):
            add(text, {"anchor": f"p{n + 1}", "snapshot": "original"})
    elif kind in ("txt", "md"):
        data = path.read_bytes()
        encodings = ("utf-16",) if data.startswith((b"\xff\xfe", b"\xfe\xff")) else ("utf-8-sig", "gb18030")
        for encoding in encodings:
            try:
                text = data.decode(encoding)
                break
            except UnicodeError:
                continue
        else:
            text = data.decode("utf-8", errors="replace")
            warnings.append("存在无法识别的字符，原件保留")
            coverage["complete"] = False
        # Windows 文本常带 CRLF；raw 保留段落内容，换行统一为 \n，不把 \r 留在原文层。
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        for n, raw in enumerate(re.split(r"\n\s*\n", text)):
            if raw.strip():
                add(raw, {"paragraph": n + 1})
    else:
        raise ValueError("此格式仅存档；旧 DOC/XLS 请转换为 DOCX/XLSX")
    if not any(b.get("raw", "").strip() for b in blocks):
        coverage["complete"] = False
    return {"blocks": blocks, "assets": assets, "coverage": coverage, "metadata": metadata, "warnings": warnings}
