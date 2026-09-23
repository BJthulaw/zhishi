# 知拾总体架构图

基于 v0.1.11 实际代码绘制；画布 2000×1000（16:8），PNG 导出 4000×2000。SVG 可编辑、可无损缩放。

- [高清 PNG](知拾-总体架构.png)
- [矢量 SVG](知拾-总体架构.svg)

## 代码依据

| 架构部分 | 对应实现 |
| --- | --- |
| 阅读与交互 | `frontend/main.tsx`、`ParallelReader.tsx`、`CitationBar.tsx`、`package.json` |
| 桌面隔离、凭据与接口桥接 | `desktop/main.cjs`、`desktop/preload.cjs`、`desktop/operations.cjs` |
| 本地 API、随机端口与后台任务 | `app/__main__.py`、`app/api.py`、`app/jobs.py`、`app/worker.py` |
| 解析、检索和证据 | `app/parsers.py`、`pdf_layout.py`、`local_search.py`、`answer_support.py` |
| 模型任务、分批译文与用量 | `app/provider.py`、`translation.py`、`llm_parse.py` |
| 原件、JSON 修订、SQLite 与备份 | `app/store.py`、`app/backup.py` |

这是逻辑组件总览：箭头表示主要调用或数据流，返回值沿既有请求链回到界面，未逐条展开。应用、引擎与资料库位于用户设备；公开网页和按需模型调用涉及外部网络。OCR 可选，本地检索使用同义概念与 BM25，而非向量数据库。

## 重建与验证

在项目根目录运行：

```powershell
.venv/Scripts/python.exe scripts/architecture_diagram.py
node scripts/render-architecture.mjs
```

渲染脚本使用本机 Edge 无头模式，检查 2:1 比例和所有文字的画布边界，输出验证记录。导出后须人工查看 PNG；本次已完成视觉检查，文字、箭头和模块无明显遮挡。仅新增架构文档及生成脚本，未修改应用运行代码。
