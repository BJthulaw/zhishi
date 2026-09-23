"""Conservative CJK line reconstruction using geometry, not PDF drawing blocks."""

import re
from statistics import median


def text_of(line):
    return "".join(s["text"] for s in line["spans"])


def printed_page(page):
    candidates = []
    for b in page.get_text("dict")["blocks"]:
        for line in b.get("lines", []):
            text = text_of(line).strip()
            # Only isolated footer numerals; never turn a year or an in-text number into a page.
            match = re.fullmatch(r"[—–\-·\s]*([0-9]{1,5})[—–\-·\s]*", text)
            if match and line["bbox"][1] > page.rect.height * 0.93:
                candidates.append((line["bbox"][1], match[1]))
            elif line["bbox"][1] > page.rect.height * 0.93:
                for span in line["spans"]:
                    if re.fullmatch(r"[0-9]{1,5}", span["text"].strip()):
                        candidates.append((line["bbox"][1], span["text"].strip()))
    if not candidates:
        return None
    bottom = max(y for y, _ in candidates)
    values = {value for y, value in candidates if y >= bottom - 3}
    return next(iter(values)) if len(values) == 1 else None


def cjk_items(page):
    original = page.get_text("dict", sort=False)["blocks"]
    lines = [l for b in original for l in b.get("lines", [])]
    total = "".join(text_of(l) for l in lines)
    if len(re.findall(r"[\u4e00-\u9fff]", total)) < len(total) * 0.45:
        return original
    # Leave multi-column layouts to the native reading order until column boundaries are known.
    wide = [l for l in lines if l["bbox"][2] - l["bbox"][0] > page.rect.width * 0.6]
    if not wide or len(wide) < len(lines) * 0.35:
        return original
    lines.sort(key=lambda l: (round(l["bbox"][3] / 3), l["bbox"][0]))
    rows = []
    seen = set()
    for line in lines:
        box = list(line["bbox"])
        key = (text_of(line), tuple(round(v) for v in box))
        if key in seen:  # Identical overprinted glyphs (bold simulation).
            continue
        seen.add(key)
        if rows and abs(box[3] - rows[-1]["bbox"][3]) < 3 and box[0] >= rows[-1]["bbox"][2] - 2:
            rows[-1]["spans"] += line["spans"]
            rows[-1]["bbox"][2] = max(box[2], rows[-1]["bbox"][2])
        else:
            rows.append({**line, "bbox": box, "spans": list(line["spans"])})
    left = median(l["bbox"][0] for l in wide)
    right = median(l["bbox"][2] for l in wide)
    groups = []
    for line in rows:
        size = max((s["size"] for s in line["spans"]), default=10)
        similar = [l for l in wide if abs(max((s["size"] for s in l["spans"]), default=10) - size) < 1]
        local_left = median(l["bbox"][0] for l in similar) if similar else left
        local_right = median(l["bbox"][2] for l in similar) if similar else right
        join = False
        if groups:
            prev = groups[-1]["lines"][-1]
            psize = max((s["size"] for s in prev["spans"]), default=10)
            gap = line["bbox"][1] - prev["bbox"][3]
            join = (
                abs(size - psize) < 1
                and 0 <= gap < size * 0.9
                and line["bbox"][0] < local_left + size * 1.3
                and prev["bbox"][2] > local_right - size * 2
                and 0.075 * page.rect.height < line["bbox"][1] < 0.93 * page.rect.height
            )
        if join:
            g = groups[-1]
            g["lines"].append(line)
            g["bbox"] = [
                min(g["bbox"][0], line["bbox"][0]),
                g["bbox"][1],
                max(g["bbox"][2], line["bbox"][2]),
                line["bbox"][3],
            ]
        else:
            groups.append({"type": 0, "bbox": list(line["bbox"]), "lines": [line]})
    groups.extend(b for b in original if b["type"] != 0)
    return sorted(groups, key=lambda b: (b["bbox"][1], b["bbox"][0]))
