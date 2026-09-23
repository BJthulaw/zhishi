"""OCR adapters keep derived text separate from immutable originals."""

import base64
import io
import shutil
import subprocess
from PIL import Image
from .store import atomic, json_bytes


def render_worker(path, kind, output):
    try:
        images = []
        if kind == "pdf":
            import pymupdf

            with pymupdf.open(path) as doc:
                if len(doc) > 100:
                    raise ValueError("云端 OCR 每次限 100 页，请拆分文档；原件不变")
                for index, page in enumerate(doc):
                    if page.get_text().strip():
                        continue
                    pix = page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5), alpha=False)
                    images.append({"page_index": index, "data": base64.b64encode(pix.tobytes("png")).decode()})
        else:
            with Image.open(path) as image:
                image = image.convert("RGB")
                image.thumbnail((2000, 2000))
                data = io.BytesIO()
                image.save(data, format="PNG")
                images.append({"page_index": 0, "data": base64.b64encode(data.getvalue()).decode()})
        atomic(output, json_bytes({"images": images}))
    except Exception as error:
        atomic(output, json_bytes({"error": str(error)}))


def local_ocr(image_path):
    binary = shutil.which("tesseract")
    if not binary:
        return None
    result = subprocess.run(
        [binary, str(image_path), "stdout", "-l", "chi_sim+eng"],
        capture_output=True,
        timeout=90,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if result.returncode:
        raise ValueError("本地 Tesseract 识别失败，请检查中文语言包")
    return result.stdout.decode("utf8").strip()
