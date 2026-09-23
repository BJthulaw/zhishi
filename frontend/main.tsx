import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BookOpen,
  Search,
  Plus,
  NotebookPen,
  MessagesSquare,
  Settings,
  FileText,
  ChevronRight,
  Upload,
  Link,
  Quote,
  FolderOpen,
  Check,
  ArrowUpRight,
  Download,
  RefreshCw,
  X,
  Library,
  ShieldCheck,
} from "lucide-react";
import {
  api,
  Topic,
  Source,
  Note,
  Evidence,
  Answer,
  Job,
  locationLabel,
  stateLabel,
} from "./types";
import ReadingMarks, { MarkedText } from "./ReadingMarks";
import ParallelReader, { TitleEditor, smoothSummary } from "./ParallelReader";
import CitationBar from "./CitationBar";
import PDFReader from "./PDFReader";
import PDFCleanReader from "./PDFCleanReader";
import ProviderGuide from "./ProviderGuide";
import UsagePanel from "./UsagePanel";
import "./style.css";
import { searchRequest } from "./requests";

const fieldNames: Record<string, string> = {
  authors: "作者 / 发布机构",
  volume: "卷号（可选）",
  journal: "刊名",
  year: "年份",
  issue: "期号",
  pages: "起止页",
  cited_page: "具体引证页（印刷页）",
  publisher: "出版社",
  edition: "版次",
  website: "网站",
  date: "发布 / 裁判日期",
  url: "来源 URL",
  accessed: "访问日期",
  authority: "发布 / 裁判主体",
  number: "文号 / 案号",
  provision: "条款 / 段落",
  legal_status: "版本及效力（人工核对）",
  parent_source: "母文献",
  locator: "出处位置",
};
const bibliographyFields: Record<string, string[]> = {
  journal: [
    "authors",
    "journal",
    "year",
    "volume",
    "issue",
    "pages",
    "cited_page",
  ],
  book: ["authors", "publisher", "year", "edition", "cited_page"],
  web: ["authors", "website", "date", "url", "accessed"],
  law: ["authority", "number", "date", "provision", "url", "legal_status"],
  case: ["authority", "number", "date", "provision", "url"],
  excerpt: ["parent_source", "locator", "authors", "url"],
};
function App() {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  const [providerTest, setProviderTest] = useState("");
  const [view, setView] = useState("library"),
    [topics, setTopics] = useState<Topic[]>([]),
    [sources, setSources] = useState<Source[]>([]),
    [total, setTotal] = useState(0),
    [selected, setSelected] = useState<Source | null>(null),
    [filter, setFilter] = useState<string[]>([]),
    [mode, setMode] = useState("any"),
    [query, setQuery] = useState(""),
    [kind, setKind] = useState(""),
    [pending, setPending] = useState(false),
    [offset, setOffset] = useState(0);
  const [jobs, setJobs] = useState<Job[]>([]),
    [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [capture, setCapture] = useState(""),
    [captureTitle, setCaptureTitle] = useState(""),
    [captureText, setCaptureText] = useState("");
  const [reader, setReader] = useState("clean"),
    [right, setRight] = useState("insights"),
    [page, setPage] = useState(1),
    [focusBlock, setFocusBlock] = useState(""),
    [raw, setRaw] = useState(false),
    [sheet, setSheet] = useState("");
  const [notes, setNotes] = useState<Note[]>([]),
    [draft, setDraft] = useState(""),
    [quote, setQuote] = useState(""),
    [noteBlock, setNoteBlock] = useState(""),
    [noteId, setNoteId] = useState<string | null>(null),
    [noteRevision, setNoteRevision] = useState<number | undefined>(),
    [dirty, setDirty] = useState(false);
  const [chosenTopics, setChosenTopics] = useState<string[]>([]),
    [primary, setPrimary] = useState(""),
    [bibliography, setBibliography] = useState<Record<string, string>>({}),
    [editTitle, setEditTitle] = useState(""),
    [summary, setSummary] = useState("");
  const [question, setQuestion] = useState(""),
    [answer, setAnswer] = useState<Answer | null>(null),
    [history, setHistory] = useState<Answer[]>([]),
    [scope, setScope] = useState("all");
  const [qaTopics, setQaTopics] = useState<string[]>([]);
  const [qaMode, setQaMode] = useState("any");
  const [confirmAnswer, setConfirmAnswer] = useState(false);
  const [qaPending, setQaPending] = useState<"local" | "cloud" | null>(null);
  const [qaFailure, setQaFailure] = useState("");
  const questionRef = useRef<HTMLTextAreaElement>(null);

  const [provider, setProvider] = useState<Record<string, any>>({
      base_url: "https://api.openai.com/v1",
      model: "",
      key: "",
      enabled: false,
      summary: false,
      answers: false,
      ocr: false,
    }),
    [usage, setUsage] = useState<any[]>([]),
    [library, setLibrary] = useState("");
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  async function act(action: () => Promise<any>, message = "") {
    setError("");
    setBusy(true);
    try {
      const result = await action();
      if (message) setToast(message);
      return result;
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    const [list, t] = await Promise.all([
      api.listSources({
        query,
        topic_ids: filter.join(","),
        topic_mode: mode,
        kind,
        pending,
        offset,
        limit: 30,
      }),
      api.listTopics(),
    ]);
    setSources(list.items);
    setTotal(list.total);
    setTopics(t);
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, [query, filter.join(","), mode, kind, pending, offset]);
  useEffect(() => {
    void api
      .health()
      .then((h) => setLibrary(h.library))
      .catch((e) => setError(e.message));
    void api.getProvider().then((p) => {
      if (p.base_url) setProvider({ ...p, key: "" });
    });
  }, []);
  useEffect(() => {
    let last = "";
    const timer = setInterval(async () => {
      try {
        const list: Job[] = await api.listJobs();
        setJobs(list);
        const signature = JSON.stringify(
          list.map((j) => [j.id, j.state, j.error]),
        );
        if (signature !== last) {
          last = signature;
          await refresh();
          const current = selectedRef.current;
          if (current) {
            const fresh = await api.getSource({ id: current.id });
            setSelected(fresh);
          }
        }
      } catch (e) {
        setError((e as Error).message);
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [query, filter.join(","), mode, kind, pending, offset]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!selected) return;
    setChosenTopics(selected.topic_ids);
    setPrimary(selected.primary_topic_id || "");
    setBibliography(selected.bibliography);
    setEditTitle(selected.title);
    setSummary(
      selected.summary.mode === "manual"
        ? selected.summary.text || ""
        : smoothSummary(selected.summary.text || ""),
    );
  }, [selected?.id, selected?.revision]);
  useEffect(() => {
    if (view === "notes") void api.listNotes().then(setNotes);
    if (view === "qa") {
      void api.listAnswers().then(setHistory);
      questionRef.current?.focus();
    }
    if (view === "settings")
      void api
        .usage()
        .then(setUsage)
        .catch((e) => setError(e.message));
  }, [view]);
  useEffect(() => {
    if (view !== "settings") return;
    const timer = setInterval(() => {
      void api
        .usage()
        .then(setUsage)
        .catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [view]);
  useEffect(() => {
    if (focusBlock)
      document
        .getElementById(focusBlock)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusBlock, reader, selected?.id]);
  // Drafts survive a window close without exposing any model credentials.
  useEffect(() => {
    if (!selected || !dirty) return;
    localStorage.setItem(
      "draft:" + selected.id,
      JSON.stringify({ draft, quote, noteBlock, noteId, noteRevision }),
    );
  }, [draft, quote, noteBlock, noteId, noteRevision, dirty, selected?.id]);
  async function openSource(id: string, evidence?: Evidence) {
    if (dirty && !window.confirm("当前笔记尚未保存，草稿已保留。切换文献？"))
      return;
    const source = await api.getSource({ id });
    setSelected(source);
    setView("library");
    setPage(1);
    setSheet("");
    setFocusBlock("");
    setReader("clean");
    setDirty(false);
    setDraft("");
    setQuote("");
    setNoteBlock("");
    setNoteId(null);
    setNoteRevision(undefined);
    const saved = localStorage.getItem("draft:" + id);
    if (saved) {
      try {
        const d = JSON.parse(saved);
        setDraft(d.draft);
        setQuote(d.quote);
        setNoteBlock(d.noteBlock);
        setNoteId(d.noteId);
        setNoteRevision(d.noteRevision);
        setDirty(true);
      } catch {}
    }
    setNotes(await api.listNotes({ source_id: id }));
    if (evidence) {
      if (source.parse_revision !== evidence.parse_revision) {
        setError("原文版本已变化，此证据需重新检索验证。");
        return;
      }
      const block = source.blocks.find((b: any) => b.id === evidence.block_id);
      if (!block || !block.raw.includes(evidence.quote)) {
        setError("证据定位校验失败。");
        return;
      }
      setFocusBlock(block.id);
      if (block.locator.page_index !== undefined)
        setPage(Number(block.locator.page_index) + 1);
    }
  }
  function resetFilters() {
    setFilter([]);
    setPending(false);
    setOffset(0);
    setView("library");
  }
  async function captureSubmit() {
    const result = await act(() =>
      capture === "text"
        ? api.ingestText({
            text: captureText,
            title: captureTitle || "文字摘录",
          })
        : capture === "supplement" && selected
          ? api.supplementText({
              id: selected.id,
              text: captureText,
              title: selected.title,
            })
          : api.ingestURL({
              url: captureText.trim(),
              title: captureTitle || "网页资料",
            }),
    );
    if (result) {
      setCapture("");
      setCaptureText("");
      setCaptureTitle("");
      setToast(
        result.duplicate
          ? "已存在相同原件，保留原条目。"
          : "资料已保存，正在后台处理。",
      );
      await refresh();
      await openSource(result.source_id || selected!.id);
    }
  }
  async function saveNote() {
    if (!selected || !draft.trim()) return;
    const saved = await act(
      () =>
        api.saveNote({
          id: noteId || undefined,
          expected_revision: noteRevision,
          source_id: selected.id,
          block_id: noteBlock || null,
          quote,
          markdown: draft,
          draft: false,
        }),
      "笔记已保存",
    );
    if (saved) {
      setNoteId(saved.id);
      setNoteRevision(saved.revision);
      setDirty(false);
      localStorage.removeItem("draft:" + selected.id);
      setNotes(await api.listNotes({ source_id: selected.id }));
    }
  }
  async function saveTopics() {
    if (!selected) return;
    const mix = chosenTopics.includes("other") && chosenTopics.length > 1;
    if (mix && !window.confirm("“其它”与具体主题同时选择，确认保留这个组合？"))
      return;
    const result = await act(
      () =>
        api.updateTopics({
          id: selected.id,
          expected_revision: selected.revision,
          topic_ids: chosenTopics,
          primary_topic_id: primary || null,
          confirmed: true,
          allow_other_mix: mix,
        }),
      "分类已确认，后续分析不会覆盖",
    );
    if (result) {
      setSelected(result);
      await refresh();
    }
  }
  function excerpt(block: Source["blocks"][number]) {
    const selection =
      window.getSelection()?.toString() || block.raw.slice(0, 400);
    if (!selection || !block.raw.includes(selection)) {
      setError("请从原始文字视图选择原文；整理文字可能已合并断行。");
      return;
    }
    setQuote(selection);
    setNoteBlock(block.id);
    setRight("notes");
    setDirty(true);
  }
  async function runCloud(stage: string) {
    if (!selected) return;
    const saved = await api.getProvider();
    if (
      !saved.has_key ||
      !saved.enabled ||
      !(stage === "translation"
        ? saved.translation
        : stage === "summary"
          ? saved.summary
          : saved.ocr)
    ) {
      setError(
        "请先保存模型配置，并开启云端模型及对应的翻译/摘要/图像识别权限。",
      );
      setView("settings");
      return;
    }
    if (
      !window.confirm(
        `将把《${selected.title}》的${["summary", "translation"].includes(stage) ? "正文分块" : "PDF页面图片"}发送至 ${saved.base_url}，模型 ${saved.model}。将记录预计与实际 Token 用量。${stage === "translation" ? "仅请求未保存片段；未返回结果的失败请求重试可能再次计量。" : ""}${stage === "llm_parse" ? "完成后替换整理结果，原件保留，文字和来源标记待核对。" : ""}确认发送？`,
      )
    )
      return;
    if (stage === "translation") setReader("parallel");
    await act(
      () =>
        api.analyze({
          id: selected.id,
          stage,
          cloud: true,
          authorized: true,
          destination: saved.base_url,
        }),
      "已提交模型任务",
    );
  }
  async function deleteSelected() {
    if (
      !selected ||
      !window.confirm(
        `确认删除《${selected.title}》？将删除资料库中的原件副本和解析内容；下载目录原文件、笔记及历史问答保留。此操作无法撤销。`,
      )
    )
      return;
    const r = await act(
      () => api.deleteSource({ id: selected.id }),
      "文献已删除",
    );
    if (r) {
      setSelected(null);
      setOffset(0);
      await refresh();
    }
  }
  async function ask(cloud = false, confirmed = false) {
    if (scope === "topics" && !qaTopics.length) {
      setError("请选择至少一个研究主题");
      return;
    }
    if (
      cloud &&
      (!provider.enabled ||
        !provider.has_key ||
        !provider.model ||
        !provider.answers)
    ) {
      setError(
        "模型问答尚未就绪：请在解析与偏好中保存 API Key、模型名称，开启云端模型及问答权限。也可以先使用检索证据。",
      );
      setView("settings");
      return;
    }
    if (cloud && !confirmed) {
      setConfirmAnswer(true);
      return;
    }
    setConfirmAnswer(false);
    setQaPending(cloud ? "cloud" : "local");
    setQaFailure("");
    setAnswer(null);
    const result = await act(() =>
      api.answer(
        searchRequest(
          question,
          scope === "topics" ? qaTopics : [],
          qaMode,
          scope === "current" && selected ? [selected.id] : [],
          cloud,
        ),
      ),
    );
    setQaPending(null);
    if (!result)
      setQaFailure("请求未完成，请查看上方错误提示，检查连接后重试。");
    if (result) {
      setAnswer(result);
      setHistory(await api.listAnswers());
    }
  }
  const sheets = Array.from(
    new Set(
      selected?.blocks
        .map((b) => String(b.locator.sheet || ""))
        .filter(Boolean),
    ),
  );
  const activeJobs = jobs.filter((j) =>
    ["running", "queued"].includes(j.state),
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <BookOpen size={23} />
          </span>
          <div>
            知拾<small>让每次阅读有所留存</small>
          </div>
        </div>
        <button className="capture-button" onClick={() => setCapture("choose")}>
          <Plus size={18} /> 收录文献 <kbd>＋</kbd>
        </button>
        <nav>
          <button
            className={
              view === "library" && !pending && !filter.length ? "active" : ""
            }
            onClick={resetFilters}
          >
            <Library size={17} />
            全部文献
          </button>
          <button
            className={pending ? "active" : ""}
            onClick={() => {
              setPending(true);
              setFilter([]);
              setView("library");
              setOffset(0);
            }}
          >
            <FolderOpen size={17} />
            待整理
          </button>
          <button
            className={view === "notes" ? "active" : ""}
            onClick={() => setView("notes")}
          >
            <NotebookPen size={17} />
            我的笔记
          </button>
          <button
            className={view === "qa" ? "active" : ""}
            onClick={() => setView("qa")}
          >
            <MessagesSquare size={17} />
            证据问答
          </button>
        </nav>
        <div className="nav-label">
          研究主题 <span>10</span>
        </div>
        <div className="topic-list">
          {topics.map((topic, i) => (
            <button
              key={topic.id}
              title={topic.scope}
              className={filter.includes(topic.id) ? "chosen" : ""}
              onClick={() => {
                setFilter(
                  filter.includes(topic.id)
                    ? filter.filter((x) => x !== topic.id)
                    : [...filter, topic.id],
                );
                setPending(false);
                setOffset(0);
                setView("library");
              }}
            >
              <span className={"topic-dot dot-" + i} />
              <span>{topic.name}</span>
              <small>{topic.count}</small>
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="local-status">
            <span />
            本地资料库 ·{" "}
            {activeJobs.length ? `${activeJobs.length} 项处理中` : "已就绪"}
          </div>
          <button
            onClick={() => setView("settings")}
            className={view === "settings" ? "active" : ""}
          >
            <Settings size={17} />
            解析与偏好
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <span className="eyebrow">YOUR RESEARCH, CONNECTED</span>
            <h1>
              {
                {
                  library: pending
                    ? "待整理"
                    : filter.length
                      ? "主题文献"
                      : "文献库",
                  notes: "我的笔记",
                  qa: "证据问答",
                  settings: "解析与偏好",
                }[view]
              }
            </h1>
          </div>
          <div className="top-actions">
            <span className="privacy">
              <ShieldCheck size={15} />
              本地优先
            </span>
            <button
              onClick={() =>
                act(() => api.importFiles(), "文件已存档").then(refresh)
              }
              disabled={busy}
            >
              <Upload size={16} />
              导入文件
            </button>
          </div>
        </header>
        {error && (
          <div className="notice error" role="alert">
            {error}
            <button aria-label="关闭提示" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {toast && (
          <div className="toast" role="status">
            <Check size={16} />
            {toast}
          </div>
        )}
        {view === "library" && (
          <>
            <div className="library-toolbar">
              <label className="search-box">
                <Search size={18} />
                <input
                  aria-label="搜索文献"
                  placeholder="搜索标题、正文中的关键词…"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setOffset(0);
                  }}
                />
              </label>
              <select
                aria-label="文件类型"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  setOffset(0);
                }}
              >
                <option value="">所有类型</option>
                {["pdf", "docx", "xlsx", "txt", "png", "jpg", "url"].map(
                  (x) => (
                    <option key={x}>{x}</option>
                  ),
                )}
              </select>
              {filter.length > 0 && (
                <select
                  aria-label="主题筛选方式"
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                >
                  <option value="any">属于任一所选主题</option>
                  <option value="all">同时属于所选主题</option>
                </select>
              )}
              <span className="muted">{total} 篇文献</span>
            </div>
            <div className={"workspace " + (!selected ? "no-reader" : "")}>
              <section className="source-list">
                {sources.length === 0 ? (
                  <div className="empty">
                    <BookOpen size={35} />
                    <h3>从一篇文献开始</h3>
                    <p>保存文字、网页与文件，让观点有据可寻。</p>
                    <button onClick={() => setCapture("choose")}>
                      收录第一篇文献
                    </button>
                  </div>
                ) : (
                  sources.map((source) => (
                    <button
                      key={source.id}
                      className={
                        "source-card " +
                        (source.id === selected?.id ? "selected" : "")
                      }
                      onClick={() => act(() => openSource(source.id))}
                    >
                      <div className="source-kicker">
                        <span className={"file-kind " + source.kind}>
                          {source.kind.toUpperCase()}
                        </span>
                        <span>
                          {new Date(source.created_at).toLocaleDateString(
                            "zh-CN",
                          )}
                        </span>
                      </div>
                      <h3>{source.title}</h3>
                      <p>
                        {source.summary.text?.slice(0, 95) ||
                          "原件已保存，正文等待处理…"}
                      </p>
                      <div className="chips">
                        {source.topic_ids.slice(0, 2).map((id) => (
                          <span key={id}>
                            {topics.find((t) => t.id === id)?.name}
                          </span>
                        ))}
                      </div>
                      <div className="source-status">
                        <span
                          className={
                            source.parse_status === "succeeded"
                              ? "green"
                              : "amber"
                          }
                        >
                          ●{" "}
                          {stateLabel[source.parse_status] ||
                            source.parse_status}
                        </span>
                        {source.confirmed && <span>分类已确认</span>}
                      </div>
                    </button>
                  ))
                )}
                <div className="pagination">
                  <button
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - 30))}
                  >
                    上一页
                  </button>
                  <button
                    disabled={offset + 30 >= total}
                    onClick={() => setOffset(offset + 30)}
                  >
                    下一页
                  </button>
                </div>
              </section>
              {selected && (
                <>
                  <section
                    className={"reader " + (expanded ? "reader-expanded" : "")}
                  >
                    <div className="reader-title">
                      <div className="source-kicker">
                        {selected.kind.toUpperCase()} <ChevronRight size={12} />{" "}
                        阅读工作台
                      </div>
                      <TitleEditor
                        key={selected.id}
                        source={selected}
                        onSaved={setSelected}
                      />
                      <div className="status-line">
                        <span>✓ 已存档</span>
                        <span>{stateLabel[selected.parse_status]}</span>
                        <span>{stateLabel[selected.semantic_status]}</span>
                      </div>
                      <p className="hint">
                        {selected.coverage
                          ? `覆盖：${selected.coverage.parsed} / ${selected.coverage.total} ${selected.coverage.unit} · ${selected.coverage.complete ? "已提取可用正文" : "部分内容未识别"}`
                          : "尚未解析"}
                        {selected.parse_error && ` · ${selected.parse_error}`}
                      </p>
                    </div>
                    <CitationBar
                      key={selected.id}
                      source={selected}
                      onEdit={() => setRight("source")}
                      onSaved={setSelected}
                    />
                    <div className="reader-tabs">
                      <button
                        onClick={() => setExpanded(!expanded)}
                        aria-pressed={expanded}
                      >
                        {expanded ? "恢复布局" : "放大阅读"}
                      </button>
                      <button
                        className={reader === "clean" ? "selected-tab" : ""}
                        onClick={() => setReader("clean")}
                      >
                        整理阅读
                      </button>
                      <button
                        className={reader === "original" ? "selected-tab" : ""}
                        onClick={() => setReader("original")}
                      >
                        原件
                      </button>
                      <button
                        onClick={() => setReader("parallel")}
                        className={reader === "parallel" ? "selected-tab" : ""}
                      >
                        中英对照
                      </button>
                      <button onClick={() => runCloud("translation")}>
                        LLM 逐段翻译
                      </button>
                      <span />
                      <button
                        title="重新解析"
                        onClick={() =>
                          act(
                            () =>
                              api.analyze({ id: selected.id, stage: "parse" }),
                            "已排队重新解析",
                          )
                        }
                      >
                        <RefreshCw size={14} /> 重新解析
                      </button>
                      {selected.kind === "pdf" && (
                        <button onClick={() => runCloud("llm_parse")}>
                          LLM 解析替换
                        </button>
                      )}
                      <button
                        className="danger"
                        onClick={deleteSelected}
                        disabled={busy}
                      >
                        删除文献
                      </button>
                      <button
                        title="保存原件副本"
                        onClick={() =>
                          act(() => api.saveOriginal({ id: selected.id }))
                        }
                      >
                        <Download size={14} />
                      </button>
                    </div>
                    <div
                      className="reader-scroll"
                      tabIndex={0}
                      aria-label="文献阅读区"
                    >
                      {reader === "parallel" ? (
                        <ParallelReader source={selected} />
                      ) : reader === "original" ? (
                        selected.kind === "pdf" ? (
                          <PDFReader
                            sourceId={selected.id}
                            page={page}
                            onPage={setPage}
                          />
                        ) : ["png", "jpg", "jpeg", "webp"].includes(
                            selected.kind,
                          ) ? (
                          <img
                            className="original-image"
                            src={`zhishi-asset://source/${selected.id}/original`}
                          />
                        ) : (
                          <div className="empty">
                            <FileText size={36} />
                            <h3>原始文件已安全保存</h3>
                            <p>
                              Word、表格和网页请在整理阅读中查看。可保存原件副本，用对应程序打开。
                            </p>
                            <button
                              onClick={() =>
                                act(() => api.saveOriginal({ id: selected.id }))
                              }
                            >
                              保存原件副本
                            </button>
                          </div>
                        )
                      ) : (
                        <ReadingMarks
                          key={selected.id}
                          source={selected}
                          raw={raw}
                          onSaved={setSelected}
                        >
                          <div className="reading-options">
                            <label>
                              <input
                                type="checkbox"
                                checked={raw}
                                onChange={(e) => setRaw(e.target.checked)}
                              />
                              显示原始断行
                            </label>
                            {sheets.length > 0 && (
                              <select
                                value={sheet}
                                onChange={(e) => setSheet(e.target.value)}
                              >
                                <option value="">全部工作表</option>
                                {sheets.map((s) => (
                                  <option key={s}>{s}</option>
                                ))}
                              </select>
                            )}
                          </div>
                          {selected.warnings.map((w, i) => (
                            <p className="hint amber" key={i}>
                              {w}
                            </p>
                          ))}
                          {selected.kind === "pdf" ? (
                            <PDFCleanReader
                              source={selected}
                              raw={raw}
                              focus={focusBlock}
                              onExcerpt={excerpt}
                            />
                          ) : (
                            selected.blocks
                              .filter(
                                (b) => !sheet || b.locator.sheet === sheet,
                              )
                              .map((block) => (
                                <article
                                  className={
                                    "content-block " +
                                    (focusBlock === block.id ? "focused" : "")
                                  }
                                  key={block.id}
                                  id={block.id}
                                >
                                  <div className="block-meta">
                                    <span>{locationLabel(block.locator)}</span>
                                    {block.raw && (
                                      <button
                                        title="摘录到笔记"
                                        onClick={() => excerpt(block)}
                                      >
                                        <Quote size={13} />
                                        摘录
                                      </button>
                                    )}
                                  </div>
                                  {block.type === "image" ? (
                                    <img
                                      className="block-image"
                                      src={
                                        block.asset === "original"
                                          ? `zhishi-asset://source/${selected.id}/original`
                                          : `zhishi-asset://source/${selected.id}/assets/${selected.asset_revision || selected.parse_revision}/${block.asset}`
                                      }
                                    />
                                  ) : block.type === "table" ? (
                                    <>
                                      <div className="table-wrap">
                                        <table>
                                          <tbody>
                                            {block.rows?.map((row, ri) => (
                                              <tr key={ri}>
                                                {row.map((cell, ci) => (
                                                  <td key={ci}>{cell}</td>
                                                ))}
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                      {block.merged?.length ? (
                                        <p className="hint">
                                          合并区域：{block.merged.join("、")}
                                        </p>
                                      ) : null}
                                      {block.cells
                                        ?.filter((c) => c.formula)
                                        .map((c) => (
                                          <p
                                            className="formula"
                                            key={c.coordinate}
                                          >
                                            {c.coordinate}：{c.formula} →{" "}
                                            {c.cached ? c.value : "未计算"}
                                          </p>
                                        ))}
                                    </>
                                  ) : (
                                    <p className="body-text">
                                      <MarkedText
                                        text={raw ? block.raw : block.clean}
                                        blockId={block.id}
                                        raw={raw}
                                        revision={selected.parse_revision}
                                      />
                                    </p>
                                  )}
                                </article>
                              ))
                          )}
                          {!selected.blocks.length && (
                            <div className="empty">
                              <FileText size={32} />
                              <p>正文尚未就绪，原件已保留。</p>
                              <button onClick={() => setCapture("supplement")}>
                                补充已核对正文
                              </button>
                            </div>
                          )}
                        </ReadingMarks>
                      )}
                    </div>
                  </section>
                  <aside className="detail-panel">
                    <div className="detail-tabs">
                      {[
                        ["insights", "摘要"],
                        ["notes", "笔记"],
                        ["source", "来源"],
                      ].map(([id, label]) => (
                        <button
                          key={id}
                          className={right === id ? "selected-tab" : ""}
                          onClick={() => setRight(id)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div
                      className="detail-scroll"
                      tabIndex={0}
                      aria-label="文献信息面板"
                    >
                      {right === "insights" && (
                        <>
                          <div className="section-heading">
                            <h3>阅读线索</h3>
                            <span className="pill">
                              {selected.summary.label || "等待解析"}
                            </span>
                          </div>
                          <textarea
                            className="summary-editor"
                            aria-label="摘要"
                            value={summary}
                            onChange={(e) => setSummary(e.target.value)}
                            placeholder="可填写你核对后的摘要"
                          />
                          <div className="button-row">
                            <button
                              onClick={() =>
                                act(
                                  () =>
                                    api.updateSummary({
                                      id: selected.id,
                                      expected_revision: selected.revision,
                                      text: summary,
                                    }),
                                  "摘要已保存",
                                ).then((r) => r && setSelected(r))
                              }
                            >
                              保存摘要
                            </button>
                            <button
                              disabled={!provider.enabled}
                              onClick={() => runCloud("summary")}
                            >
                              生成约300字摘要
                            </button>
                          </div>
                          <div className="chips keywords">
                            {selected.summary.keywords?.map((k) => (
                              <span key={k}># {k}</span>
                            ))}
                          </div>
                          <div className="section-heading">
                            <h3>主题归属</h3>
                            {selected.confirmed && (
                              <span className="green">已人工确认</span>
                            )}
                          </div>
                          <p className="hint">
                            一份原件可归属多个主题。修改后请点击下方“保存分类”，人工确认优先。
                          </p>
                          <div className="topic-checks">
                            {topics.map((t) => (
                              <label key={t.id}>
                                <input
                                  type="checkbox"
                                  checked={chosenTopics.includes(t.id)}
                                  onChange={() => {
                                    const values = chosenTopics.includes(t.id)
                                      ? chosenTopics.filter((x) => x !== t.id)
                                      : [...chosenTopics, t.id];
                                    setChosenTopics(values);
                                    if (!values.includes(primary))
                                      setPrimary(values[0] || "");
                                  }}
                                />
                                {t.name}
                              </label>
                            ))}
                          </div>
                          <label className="field">
                            主主题
                            <select
                              value={primary}
                              onChange={(e) => setPrimary(e.target.value)}
                            >
                              <option value="">未指定</option>
                              {chosenTopics.map((id) => (
                                <option value={id} key={id}>
                                  {topics.find((t) => t.id === id)?.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div className="button-row topic-save-actions">
                            <button
                              className="primary"
                              disabled={busy}
                              onClick={saveTopics}
                            >
                              保存分类
                            </button>
                            <button
                              onClick={() =>
                                act(
                                  () =>
                                    api.undoTopics({
                                      id: selected.id,
                                      expected_revision: selected.revision,
                                    }),
                                  "已撤销分类修改",
                                ).then((r) => {
                                  if (r) {
                                    setSelected(r);
                                    void refresh();
                                  }
                                })
                              }
                            >
                              撤销
                            </button>
                          </div>
                          <details>
                            <summary>查看自动分类依据</summary>
                            <p>{selected.classification?.reason}</p>
                            {selected.classification?.candidates.map((c) => (
                              <div className="candidate" key={c.id}>
                                <b>{c.name}</b>
                                <p>{c.reason}</p>
                                <small>规则匹配分 {c.score}，非准确概率</small>
                              </div>
                            ))}
                          </details>
                        </>
                      )}
                      {right === "notes" && (
                        <>
                          <h3>我的思考</h3>
                          <p className="hint">
                            个人笔记与原文区分保存，不自动作为学术证据。
                          </p>
                          {quote && (
                            <blockquote>
                              {quote}
                              <button
                                onClick={() => {
                                  setQuote("");
                                  setNoteBlock("");
                                  setDirty(true);
                                }}
                              >
                                移除摘录
                              </button>
                            </blockquote>
                          )}
                          <textarea
                            aria-label="笔记正文"
                            className="note-editor"
                            value={draft}
                            placeholder="记下观点、疑问或写作线索…支持 Markdown 文本"
                            onChange={(e) => {
                              setDraft(e.target.value);
                              setDirty(true);
                            }}
                          />
                          <div className="button-row">
                            <button
                              className="primary"
                              disabled={!draft.trim() || busy}
                              onClick={saveNote}
                            >
                              保存笔记
                            </button>
                            <span className="hint">
                              {dirty ? "未保存 · 本机草稿已保留" : "已保存"}
                            </span>
                          </div>
                          <button
                            onClick={() => {
                              setNoteId(null);
                              setNoteRevision(undefined);
                              setDraft("");
                              setQuote("");
                              setNoteBlock("");
                              setDirty(false);
                            }}
                          >
                            新建笔记
                          </button>
                          {notes.map((n) => (
                            <article className="note-card" key={n.id}>
                              <p>{n.markdown}</p>
                              {n.source_deleted && (
                                <small>原文献已删除，笔记保留</small>
                              )}
                              <small>
                                {new Date(n.updated_at).toLocaleString("zh-CN")}
                              </small>
                              <button
                                onClick={() => {
                                  setNoteId(n.id);
                                  setNoteRevision(n.revision);
                                  setDraft(n.markdown);
                                  setQuote(n.quote);
                                  setNoteBlock(n.block_id || "");
                                  setDirty(false);
                                }}
                              >
                                编辑
                              </button>
                            </article>
                          ))}
                        </>
                      )}
                      {right === "source" && (
                        <>
                          <h3>来源记录</h3>
                          <label className="field">
                            题名
                            <input
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                            />
                          </label>
                          <label className="field">
                            文献类型
                            <select
                              value={bibliography.type || "excerpt"}
                              onChange={(e) =>
                                setBibliography({
                                  ...bibliography,
                                  type: e.target.value,
                                })
                              }
                            >
                              {Object.entries({
                                journal: "期刊文章",
                                book: "专著 / 章节",
                                web: "网页",
                                law: "法规",
                                case: "裁判",
                                excerpt: "图片 / 表格 / 摘录",
                              }).map(([id, label]) => (
                                <option value={id} key={id}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                          {(
                            bibliographyFields[bibliography.type] ||
                            bibliographyFields.excerpt
                          ).map((field) => (
                            <label className="field" key={field}>
                              {fieldNames[field]}
                              <input
                                value={bibliography[field] || ""}
                                onChange={(e) =>
                                  setBibliography({
                                    ...bibliography,
                                    [field]: e.target.value,
                                  })
                                }
                              />
                            </label>
                          ))}
                          <label className="field">
                            标签（逗号分隔）
                            <input
                              value={selected.tags.join(",")}
                              onChange={(e) =>
                                setSelected({
                                  ...selected,
                                  tags: e.target.value
                                    .split(/[,，]/)
                                    .filter(Boolean),
                                })
                              }
                            />
                          </label>
                          <label className="field">
                            关键词（最多十个）
                            <input
                              value={(selected.summary.keywords || []).join(
                                ",",
                              )}
                              onChange={(e) =>
                                setSelected({
                                  ...selected,
                                  summary: {
                                    ...selected.summary,
                                    keywords: e.target.value
                                      .split(/[,，]/)
                                      .filter(Boolean)
                                      .slice(0, 10),
                                  },
                                })
                              }
                            />
                          </label>
                          <label className="field">
                            DOI（可选）
                            <input
                              value={bibliography.doi || ""}
                              onChange={(e) =>
                                setBibliography({
                                  ...bibliography,
                                  doi: e.target.value,
                                })
                              }
                            />
                          </label>
                          <button
                            className="primary"
                            onClick={() =>
                              act(
                                () =>
                                  api.updateMetadata({
                                    id: selected.id,
                                    expected_revision: selected.revision,
                                    title: editTitle,
                                    bibliography,
                                    tags: selected.tags,
                                    keywords: selected.summary.keywords || [],
                                  }),
                                "来源已保存",
                              ).then((r) => r && setSelected(r))
                            }
                          >
                            保存来源
                          </button>
                          <button onClick={() => setCapture("supplement")}>
                            补充 / 更正正文
                          </button>
                          <div className="button-row">
                            <button
                              onClick={() =>
                                act(
                                  () =>
                                    api.analyze({
                                      id: selected.id,
                                      stage: "ocr",
                                    }),
                                  "已提交本地 OCR",
                                )
                              }
                            >
                              本地 OCR
                            </button>
                            <button
                              disabled={!provider.ocr}
                              onClick={() => runCloud("ocr")}
                            >
                              授权图像识别
                            </button>
                            <button
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "请确认已逐页对照原件核对全部 OCR 文字；确认后将纳入证据检索。",
                                  )
                                )
                                  void act(
                                    () =>
                                      api.confirmOCR({
                                        id: selected.id,
                                        expected_revision: selected.revision,
                                      }),
                                    "识别文字已确认",
                                  ).then((r) => r && setSelected(r));
                              }}
                            >
                              确认 OCR 文字
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </aside>
                </>
              )}
            </div>
          </>
        )}
        {view === "notes" && (
          <div className="wide-content">
            <div className="intro">
              <span className="eyebrow">THOUGHTS WORTH KEEPING</span>
              <h2>把阅读变成自己的思考。</h2>
              <p>每条笔记连接原文，保留你当时的问题与判断。</p>
            </div>
            <div className="notes-grid">
              {notes.length ? (
                notes.map((n) => (
                  <article key={n.id} className="note-card">
                    <NotebookPen size={18} />
                    {n.quote && <blockquote>{n.quote}</blockquote>}
                    <p>{n.markdown}</p>
                    {n.source_deleted && <small>原文献已删除，笔记保留</small>}
                    <small>
                      {new Date(n.updated_at).toLocaleString("zh-CN")}
                    </small>
                    <button
                      disabled={n.source_deleted}
                      onClick={() =>
                        act(() => openSource(n.source_id)).then(() =>
                          setRight("notes"),
                        )
                      }
                    >
                      回到文献 <ArrowUpRight size={14} />
                    </button>
                  </article>
                ))
              ) : (
                <div className="empty">
                  打开一篇文献，在右侧记录第一条笔记。
                </div>
              )}
            </div>
          </div>
        )}
        {view === "qa" && (
          <div className="wide-content qa">
            <div className="intro">
              <span className="eyebrow">EVIDENCE BEFORE ANSWERS</span>
              <h2>让文献回答你的研究问题。</h2>
              <p>先找到原文，再核对观点。没有足够依据时，明确留白。</p>
            </div>
            <div
              className="question-box"
              onClick={(e) => {
                if (e.target === e.currentTarget) questionRef.current?.focus();
              }}
            >
              <textarea
                ref={questionRef}
                aria-label="研究问题"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="例如：个人信息处理中的知情同意，有哪些限制？"
              />
              <div>
                <select
                  aria-label="问答文献范围"
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                >
                  <option value="all">全部文献</option>
                  <option value="topics">选择研究主题</option>
                  <option value="current" disabled={!selected}>
                    当前文献
                  </option>
                </select>
                <button
                  disabled={!question.trim() || busy}
                  onClick={() => ask(false)}
                >
                  <Search size={15} />
                  检索证据
                </button>
                <button
                  className="primary"
                  disabled={!question.trim() || busy}
                  onClick={() => ask(true)}
                >
                  基于文献回答
                </button>
              </div>
            </div>
            {scope === "topics" && (
              <fieldset className="qa-topics">
                <legend>研究主题（可多选）</legend>
                <div className="qa-topic-options">
                  {topics.map((t) => (
                    <label key={t.id}>
                      <input
                        type="checkbox"
                        checked={qaTopics.includes(t.id)}
                        onChange={(e) =>
                          setQaTopics((ids) =>
                            e.target.checked
                              ? [...ids, t.id]
                              : ids.filter((id) => id !== t.id),
                          )
                        }
                      />
                      {t.name}
                    </label>
                  ))}
                </div>
                <label>
                  主题匹配方式{" "}
                  <select
                    aria-label="问答主题匹配方式"
                    value={qaMode}
                    onChange={(e) => setQaMode(e.target.value)}
                  >
                    <option value="any">属于任一所选主题</option>
                    <option value="all">同时属于全部所选主题</option>
                  </select>
                </label>
              </fieldset>
            )}
            {confirmAnswer && (
              <section
                role="dialog"
                aria-label="确认模型问答"
                className="qa-confirm"
              >
                <h3>确认发送相关证据</h3>
                <p>
                  将相关原文发送至 {provider.base_url}，模型 {provider.model}
                  。Token 用量会记录。
                </p>
                <button
                  onClick={() => {
                    setConfirmAnswer(false);
                    questionRef.current?.focus();
                  }}
                >
                  取消
                </button>
                <button
                  className="primary"
                  onClick={() => void ask(true, true)}
                >
                  确认并生成回答
                </button>
              </section>
            )}
            <section
              className="ai-answer-panel"
              aria-label="AI 回答"
              aria-live="polite"
              aria-busy={qaPending === "cloud"}
            >
              <h2>AI 回答</h2>
              {answer?.answer_reason && !qaPending && (
                <p className="hint">{answer.answer_reason}</p>
              )}
              {qaPending ? (
                <p role="status">
                  {qaPending === "cloud"
                    ? "正在检索文献、生成回答并核对出处，请稍候…"
                    : "正在本地检索原文…"}
                </p>
              ) : qaFailure ? (
                <p role="alert">{qaFailure}</p>
              ) : answer?.claims.some((c) => c.text) ? (
                <>
                  <h3>{answer.question}</h3>
                  {answer.claims
                    .filter((c) => c.text)
                    .map((c, i) => (
                      <div key={i} className="answer-paragraph">
                        <p>{c.text}</p>
                        {(c.evidence_ids || [c.evidence_id]).map((id) => {
                          const e = answer.evidence.find((e) => e.id === id);
                          return e ? (
                            <button
                              key={id}
                              onClick={() =>
                                act(() => openSource(e.source_id, e))
                              }
                            >
                              来源 [{answer.evidence.indexOf(e) + 1}]：{e.title}{" "}
                              · {locationLabel(e.locator)}
                            </button>
                          ) : null;
                        })}
                      </div>
                    ))}
                  <small>
                    {answer.stale
                      ? "来源已变化，请重新提问核对。"
                      : "AI 文献解读（已关联来源，非原文逐字结论），请结合原文核对。"}
                  </small>
                </>
              ) : (
                <p>
                  {answer
                    ? answer.scope?.cloud
                      ? "模型没有返回带有效来源的解答。可调整问题或扩大文献范围后重试；下方保留相关原文。"
                      : "本次为本地证据检索。点击“基于文献回答”生成 AI 解答。"
                    : "输入问题并点击“基于文献回答”，解答将在这里显示。"}
                </p>
              )}
            </section>
            <p className="hint">
              检索证据：本地同义概念匹配与 BM25
              排序，返回原文，不调用大模型。基于文献回答：将相关证据交给 AI
              理解、归纳，每个要点附来源。概念词表尚未覆盖的同义表达可换关键词重试。
            </p>
            {answer && (
              <section className="answer">
                <h3>原文证据 · {answer.question}</h3>
                <p className="answer-notice">
                  {answer.stale
                    ? "资料已变更，请重新检索核对。"
                    : answer.message}
                </p>
                {answer.claims.map((c, i) => (
                  <div className="model-claim" key={i}>
                    {c.quote && <blockquote>直接引文：{c.quote}</blockquote>}
                    {(() => {
                      const e = answer.evidence.find(
                        (e) => e.id === c.evidence_id,
                      );
                      return e ? (
                        <button
                          onClick={() => act(() => openSource(e.source_id, e))}
                        >
                          来源 [{answer.evidence.indexOf(e) + 1}]：{e.title} ·{" "}
                          {locationLabel(e.locator)} · 核对原文
                        </button>
                      ) : (
                        <small>来源待核对</small>
                      );
                    })()}
                  </div>
                ))}
                <div className="evidence-grid">
                  {answer.evidence.map((e, i) => (
                    <article className="evidence-card" key={e.id}>
                      <div className="evidence-number">
                        {String(i + 1).padStart(2, "0")} <span>原文证据</span>
                      </div>
                      <h3>{e.title}</h3>
                      <blockquote>{e.quote}</blockquote>
                      <div className="evidence-footer">
                        <small>{locationLabel(e.locator)}</small>
                        <button
                          onClick={() => act(() => openSource(e.source_id, e))}
                        >
                          核对原文 <ArrowUpRight size={14} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}
            <h3>查询记录</h3>
            {history
              .slice()
              .reverse()
              .map((a) => (
                <button
                  className="history"
                  key={a.id}
                  disabled={qaPending !== null}
                  onClick={() => {
                    setQaFailure("");
                    setConfirmAnswer(false);
                    setAnswer(a);
                  }}
                >
                  {a.question}
                  <span>
                    {a.stale ? "待重新验证" : `${a.evidence.length} 条证据`}
                  </span>
                </button>
              ))}
          </div>
        )}
        {view === "settings" && (
          <div className="wide-content settings">
            <section className="settings-card">
              <h2>资料与备份</h2>
              <p className="hint">原件和记录留在本机；备份不含 API Key。</p>
              <code>{library}</code>
              <div className="button-row">
                <button
                  onClick={() =>
                    act(() => api.exportLibrary()).then(
                      (r) => r?.path && setToast("备份已保存：" + r.path),
                    )
                  }
                >
                  导出完整备份
                </button>
                <button
                  onClick={() =>
                    act(() => api.restoreLibrary()).then(
                      (r) =>
                        r?.restart &&
                        setToast("已恢复至新目录，重启应用后打开"),
                    )
                  }
                >
                  验证并恢复备份
                </button>
                <button
                  onClick={() =>
                    act(() => api.chooseLibrary()).then(
                      (r) => r?.restart && setToast("已设置资料库，重启后生效"),
                    )
                  }
                >
                  更换资料库
                </button>
              </div>
            </section>
            <section className="settings-card">
              <h2>LLM 连接与 API Key</h2>
              <ProviderGuide provider={provider} setProvider={setProvider} />
              <p className="hint">
                {provider.has_key
                  ? "API Key 已配置。输入新 Key 并保存即可替换；留空保留现有 Key。"
                  : "尚未配置 API Key。填写服务地址、模型名称与 Key 后保存。"}
              </p>
              <p className="hint">
                Key 使用系统加密保存。每次发送正文前确认；按任务记录 Token
                用量。无需 Key 即可使用本地功能。
              </p>
              <div className="settings-grid">
                {[
                  ["base_url", "Base URL"],
                  ["model", "模型名称"],
                  ["key", "API Key"],
                ].map(([id, label]) => (
                  <label className="field" key={id}>
                    {label}
                    <input
                      type={id === "key" ? "password" : "text"}
                      autoComplete="off"
                      value={provider[id] || ""}
                      placeholder={
                        id === "key" && provider.has_key
                          ? "已配置；留空保留"
                          : ""
                      }
                      onChange={(e) =>
                        setProvider({ ...provider, [id]: e.target.value })
                      }
                    />
                  </label>
                ))}
              </div>
              <div className="checkbox-row">
                {[
                  ["enabled", "启用云端模型"],
                  ["summary", "允许摘要提炼"],
                  ["translation", "允许手动翻译"],
                  ["answers", "允许问答与证据精选"],
                  ["ocr", "允许图像识别"],
                ].map(([id, label]) => (
                  <label key={id}>
                    <input
                      type="checkbox"
                      checked={!!provider[id]}
                      onChange={(e) =>
                        setProvider({ ...provider, [id]: e.target.checked })
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
              <div className="button-row">
                <button
                  className="primary"
                  onClick={() =>
                    act(() => {
                      const p = { ...provider };
                      delete p.has_key;
                      return api.saveProvider(p);
                    }, "配置已加密保存").then(
                      (p) => p && setProvider({ ...p, key: "" }),
                    )
                  }
                >
                  保存配置 / 更新 Key
                </button>
                <button
                  disabled={busy}
                  onClick={async () => {
                    setProviderTest("正在保存并调用所填模型，请稍候……");
                    const r = await act(async () => {
                      const p = { ...provider };
                      delete p.has_key;
                      const saved = await api.saveProvider(p);
                      setProvider({ ...saved, key: "" });
                      try {
                        const result = await api.testProvider();
                        setProviderTest(result.message);
                        return result;
                      } catch (e) {
                        setProviderTest((e as Error).message);
                        throw e;
                      }
                    });
                    if (!r)
                      setProviderTest((v) =>
                        v.startsWith("正在")
                          ? "测试失败，请检查上方错误提示及配置。"
                          : v,
                      );
                  }}
                >
                  保存并测试模型（少量 Token）
                </button>
                <button
                  onClick={() =>
                    act(() => api.clearProvider(), "已移除凭据").then(
                      (r) =>
                        r &&
                        setProvider({
                          ...provider,
                          key: "",
                          has_key: false,
                          enabled: false,
                        }),
                    )
                  }
                >
                  移除 Key
                </button>
              </div>
              <p role="status" className="provider-test-result">
                {providerTest}
              </p>
              <p className="hint">
                测试会真实调用所填模型，不发送文献；Token
                用量照常记录。无需配置价格。PDF 的 LLM
                解析替换需要支持图片输入的视觉模型。
              </p>
              <p className="hint">
                OCR 优先使用本机
                Tesseract（需中文语言包）；未安装时可单次授权视觉模型。识别文字须核对后才进入证据检索。
              </p>
            </section>
            <section className="settings-card">
              <h2>处理任务</h2>
              {jobs.length ? (
                jobs.map((j) => (
                  <div className="job-row" key={j.id}>
                    <span>{j.stage}</span>
                    <b>{stateLabel[j.state] || j.state}</b>
                    <p>{j.error}</p>
                    {["running", "queued"].includes(j.state) ? (
                      <button
                        onClick={() => act(() => api.cancelJob({ id: j.id }))}
                      >
                        取消
                      </button>
                    ) : (
                      ["failed", "interrupted"].includes(j.state) && (
                        <button
                          onClick={() => act(() => api.retryJob({ id: j.id }))}
                        >
                          重试本地阶段
                        </button>
                      )
                    )}
                  </div>
                ))
              ) : (
                <p>暂无处理任务</p>
              )}
            </section>
            <UsagePanel
              rows={usage}
              busy={busy}
              refresh={() =>
                void act(() => api.usage()).then((r) => r && setUsage(r))
              }
            />
          </div>
        )}
      </main>
      {capture && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="收录文献"
          >
            <button
              className="modal-close"
              aria-label="关闭"
              onClick={() => setCapture("")}
            >
              <X size={20} />
            </button>
            <span className="eyebrow">KEEP WHAT MATTERS</span>
            <h2>
              {capture === "supplement" ? "补充已核对正文" : "收录新的文献"}
            </h2>
            {capture === "choose" ? (
              <>
                <p className="muted">先保存，慢慢整理。你的资料会留在本机。</p>
                <div className="capture-options">
                  <button
                    onClick={() => {
                      setCapture("");
                      void act(() => api.importFiles(), "文件已收录").then(
                        refresh,
                      );
                    }}
                  >
                    <Upload />
                    <b>上传文件</b>
                    <small>PDF · Word · Excel · 图片</small>
                  </button>
                  <button onClick={() => setCapture("url")}>
                    <Link />
                    <b>保存网页</b>
                    <small>公开网页正文与来源</small>
                  </button>
                  <button onClick={() => setCapture("text")}>
                    <FileText />
                    <b>记录文字</b>
                    <small>观点、片段与临时灵感</small>
                  </button>
                </div>
              </>
            ) : (
              <>
                <label className="field">
                  标题（可选）
                  <input
                    value={captureTitle}
                    onChange={(e) => setCaptureTitle(e.target.value)}
                  />
                </label>
                <label className="field">
                  {capture === "url" ? "网页链接" : "正文"}
                  <textarea
                    aria-label="收录内容"
                    rows={8}
                    value={captureText}
                    onChange={(e) => setCaptureText(e.target.value)}
                    placeholder={
                      capture === "url" ? "https://…" : "粘贴要留存的文字…"
                    }
                  />
                </label>
                <button
                  className="primary"
                  disabled={!captureText.trim() || busy}
                  onClick={captureSubmit}
                >
                  保存到资料库
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
