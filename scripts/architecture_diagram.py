"""Generate the current implementation overview, exactly 16:8."""
from pathlib import Path
from html import escape
import xml.etree.ElementTree as ET

OUT = Path(__file__).resolve().parents[1] / "docs" / "architecture"
OUT.mkdir(parents=True, exist_ok=True)
lines = ['<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1000" viewBox="0 0 2000 1000">']
lines.append('<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10Z" fill="#5275a3"/></marker></defs>')
lines.append('<style>text{font-family:"Microsoft YaHei","Segoe UI",sans-serif;fill:#20344e} .muted{fill:#60758d}</style>')

def rect(x, y, w, h, fill, stroke="none", dashed=False):
    lines.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="16" fill="{fill}" stroke="{stroke}" stroke-width="2"'+(' stroke-dasharray="8 6"' if dashed else '')+'/>')

def text(x, y, value, size=22, bold=False, muted=False):
    lines.append(f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{700 if bold else 400}"'+(' class="muted"' if muted else '')+f'>{escape(value)}</text>')

def arrow(x1,y1,x2,y2,label=None):
    lines.append(f'<path d="M{x1} {y1} L{x2} {y2}" stroke="#5275a3" stroke-width="2.5" fill="none" marker-end="url(#arrow)"/>')
    if label: text(x1+18,(y1+y2)/2+7,label,19,muted=True)

def card(x,y,w,title,detail,detail2=None,fill="#ffffff"):
    rect(x,y,w,100,fill,"#dce5ef")
    text(x+20,y+32,title,24,True)
    text(x+20,y+62,detail,19,muted=True)
    if detail2: text(x+20,y+87,detail2,19,muted=True)

rect(0,0,2000,1000,"#ffffff")
text(48,59,"知拾 · 总体架构设计",38,True)
text(48,96,"本地优先的文献阅读与知识工作台  /  当前实现 v0.1.11",22,muted=True)
text(1710,59,"ARCHITECTURE",19,True,True)
text(1740,92,"16:8 · 2026.09",18,muted=True)
rect(40,125,1510,815,"#f7faff","#cbd8e8",True)
text(65,159,"用户设备 · Electron 桌面应用 + 本地 Python 引擎",22,True)
text(1650,159,"外部资源 / 可选云端",23,True)

rect(65,181,1460,146,"#eaf1ff")
text(85,215,"01  阅读与交互层",24,True)
text(1200,215,"React · TypeScript · Vite",20,muted=True)
for x,title,sub in [(90,"文献与主题","导入 / 十类主题 / 范围筛选"),(445,"阅读工作台","PDF.js / 中英对照 / 文本标记"),(800,"知识与引注","摘要 / 笔记 / CSL 三种引注"),(1155,"证据与设置","检索 / AI 回答 / Token 用量")]:
    text(x,260,title,23,True);text(x,296,sub,20,muted=True)
arrow(270,327,270,377,"受控 IPC · preload 白名单")
rect(65,377,1460,95,"#edf5f7","#d6e7eb")
text(85,411,"02  Electron 桌面层",24,True)
text(85,448,"窗口与进程管理",22)
text(410,448,"文件对话框 / 剪贴板",22)
text(795,448,"safeStorage 加密凭据",22)
text(1180,448,"受控本地资源协议",22)
arrow(270,472,270,533,"本机 HTTP / REST · 随机端口 + 会话鉴权")
rect(65,533,1460,223,"#eef2ff","#d8dff4")
text(85,568,"03  Python 业务引擎",24,True)
text(705,568,"FastAPI / Uvicorn · 后台任务调度 · 解析子进程隔离",21,muted=True)
card(90,590,330,"多格式解析","PDF / Word / Excel / 图片","PyMuPDF · OCR · 网页正文")
card(445,590,330,"本地知识检索","领域同义概念 + BM25","主题过滤 · 原文段落定位")
card(800,590,330,"证据与元数据","出处 / 页码 / 分类 / 引注","回答来源关联与原文回跳")
card(1155,590,345,"模型任务与网关","摘要 / 证据回答 / 视觉解析","逐段翻译 · 缓存 · Token 记录")
text(90,734,"任务状态持续刷新；翻译按批显示并落盘，重启续译跳过已保存片段。",21,muted=True)
arrow(270,756,270,810,"读写文献、索引与任务状态")
rect(65,810,1460,105,"#eaf6f1","#cde5dc")
text(85,846,"04  本地资料库",24,True)
text(85,884,"原件 / 资源文件",22)
text(380,884,"版本化 JSON：文献、笔记、译文",22)
text(890,884,"SQLite：索引 / 任务 / 用量",22)
text(1300,884,"备份与恢复",22)

rect(1645,181,310,215,"#f5f8fc","#d1dceb")
text(1667,220,"资料输入",26,True)
text(1667,266,"PDF / DOCX / XLSX",22)
text(1667,303,"图片 / TXT / 公开网页",22)
text(1667,359,"原件先保存，后台解析",20,muted=True)
arrow(1645,278,1525,278)
rect(1645,533,310,223,"#f5efff","#d9c9ed",True)
text(1667,576,"LLM API（按需）",26,True)
text(1667,619,"百炼 / DeepSeek / 兼容接口",20)
text(1667,657,"用户配置 Key 与模型",21)
text(1667,697,"授权后发送必要文本或图像",19,muted=True)
text(1667,730,"返回译文、回答及 Token 用量",18,muted=True)
arrow(1525,621,1645,621)
arrow(1645,708,1525,708)
rect(1645,810,310,105,"#fff8e9","#eddfbf")
text(1667,847,"清晰的运行边界",23,True)
text(1667,883,"本地检索无需调用大模型",20,muted=True)
text(48,977,"核心路径：收录 → 解析 → 主题与索引 → 阅读 / 检索 → 可选 AI 增强 → 结果本地保存",21,True)
text(1590,977,"箭头表示主要调用或数据流",18,muted=True)
lines.append('</svg>')
svg = "\n".join(lines)
root = ET.fromstring(svg)
assert root.attrib["viewBox"] == "0 0 2000 1000"
assert len(root.findall("{http://www.w3.org/2000/svg}text")) >= 45
(OUT / "知拾-总体架构.svg").write_text(svg, encoding="utf-8")
print(OUT / "知拾-总体架构.svg")
