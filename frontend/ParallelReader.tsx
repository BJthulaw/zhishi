import { useState } from "react";
import { api, type Source } from "./types";
export function smoothSummary(text: string) {
  return text
    .replace(/([A-Za-z])-\s*\n\s*(?=[a-z])/g, "$1")
    .replace(/([\u4e00-\u9fff])\s*\n\s*(?=[\u4e00-\u9fff])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
export function TitleEditor({
  source,
  onSaved,
}: {
  source: Source;
  onSaved: (s: Source) => void;
}) {
  const [editing, setEditing] = useState(false),
    [title, setTitle] = useState(source.title),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  function edit() {
    setTitle(source.title);
    setError("");
    setEditing(true);
  }
  async function save() {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      onSaved(
        await api.updateMetadata({
          id: source.id,
          expected_revision: source.revision,
          title: title.trim(),
          bibliography: source.bibliography,
          tags: source.tags,
          keywords: source.summary.keywords || [],
        }),
      );
      setEditing(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }
  return editing ? (
    <div className="title-editor">
      <input
        autoFocus
        aria-label="修改文献标题"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={300}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            void save();
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            setEditing(false);
          }
        }}
      />
      <button onClick={save} disabled={saving || !title.trim()}>
        保存标题
      </button>
      <button disabled={saving} onClick={() => setEditing(false)}>
        取消修改
      </button>
      <small role="status">{error}</small>
    </div>
  ) : (
    <h2
      className="editable-title"
      tabIndex={0}
      title="双击修改标题（或按 Enter）"
      onDoubleClick={edit}
      onKeyDown={(e) => {
        if (e.key === "Enter") edit();
      }}
    >
      {source.title}
    </h2>
  );
}
export default function ParallelReader({ source }: { source: Source }) {
  const translation = source.translation;
  if (!translation || translation.parse_revision !== source.parse_revision)
    return (
      <p className="hint">
        当前正文尚无译文。请点击“LLM 逐段翻译”手动生成；不会自动调用模型。
      </p>
    );
  return (
    <div className="parallel-reader">
      <p className="hint">
        模型译文 · {translation.model} ·{" "}
        {translation.status === "partial"
          ? `已保存 ${translation.completed || 0} / ${translation.total || 0} 片段；每批完成后自动显示。中断后点击“LLM 逐段翻译”继续。`
          : "翻译已完成"}{" "}
        · 请结合原文核对。
      </p>
      {translation.paragraphs.map((p, i) => (
        <article className="parallel-paragraph" key={p.block_id}>
          <div>
            <small>原文 · 段落 {i + 1}</small>
            <p>{p.original}</p>
          </div>
          <div>
            <small>中文译文</small>
            <p>{p.text || "等待翻译…"}</p>
            {p.text && p.complete === false && (
              <small>本段已保存部分译文，后续片段完成后自动补齐。</small>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
