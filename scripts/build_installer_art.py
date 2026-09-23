"""High DPI loading animation with indeterminate progress."""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
out = root / "desktop/assets"
out.mkdir(exist_ok=True)
font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 36)
title = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", 64)
small = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 28)
frames = []
for i in range(40):
    im = Image.new("RGB", (1120, 640), "white")
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((76, 68, 192, 184), radius=28, fill="#145ed2")
    d.text((100, 88), "知", font=title, fill="white")
    d.text((224, 86), "知拾 · 加载中", font=title, fill="#14344c")
    d.text((80, 250), "正在加载应用、准备本地阅读引擎", font=font, fill="#415e74")
    d.text((80, 320), "请稍候，准备完成后会自动进入。", font=font, fill="#415e74")
    d.rounded_rectangle((80, 430, 1040, 454), radius=12, fill="#e6f0ff")
    x = 80 + int(i / 39 * 740)
    d.rounded_rectangle((x, 430, x + 220, 454), radius=12, fill="#1686f5")
    d.text((80, 514), "初次准备可能需要一些时间，请勿重复打开。", font=small, fill="#415e74")
    frames.append(im)
frames[0].save(out / "installing.gif", save_all=True, append_images=frames[1:], duration=75, loop=0)
frames[15].save(root / ".smoke-fixtures/installer-preview.png")
