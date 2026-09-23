import { useState, useMemo } from "react";
import { citationStyles, formatCitation, CitationStyle } from "./citations";
import { api, type Source } from "./types";
export default function CitationBar({
  source,
  onEdit,
  onSaved,
}: {
  source: Source;
  onEdit: () => void;
  onSaved: (s: Source) => void;
}) {
  const [style, setStyle] = useState<CitationStyle>("legal");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");
  const result = useMemo(() => {
    try {
      return formatCitation(source, style);
    } catch {
      return { text: "引注生成失败，请检查来源信息。", missing: [] };
    }
  }, [source.id, source.title, source.bibliography, style]);
  const override = source.bibliography[`citation_${style}`];
  const citationText = override || result.text;
  async function saveCustom(reset = false) {
    try {
      const bibliography = { ...source.bibliography };
      if (reset) delete bibliography[`citation_${style}`];
      else bibliography[`citation_${style}`] = draft.trim();
      onSaved(
        await api.updateMetadata({
          id: source.id,
          expected_revision: source.revision,
          title: source.title,
          bibliography,
          tags: source.tags,
          keywords: source.summary.keywords || [],
        }),
      );
      setEditing(false);
      setMessage(reset ? "已恢复自动引注" : "已保存手动引注");
    } catch (e) {
      setMessage(String(e));
    }
  }
  return (
    <div className="reader-citation" aria-label="文献引用">
      <div className="button-row">
        <div className="citation-styles" role="group" aria-label="引注格式">
          <span>引注格式</span>
          {Object.entries(citationStyles).map(([id, label]) => (
            <button
              key={id}
              aria-pressed={style === id}
              onClick={() => {
                setStyle(id as CitationStyle);
                setEditing(false);
                setMessage("");
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={() =>
            api.copyText({ text: citationText }).then(
              () => setMessage("已复制引注"),
              () => setMessage("复制失败，请手动选择文本"),
            )
          }
        >
          复制引注
        </button>
        <button onClick={onEdit}>核对来源</button>
        {override && (
          <button onClick={() => saveCustom(true)}>恢复自动引注</button>
        )}
      </div>
      {editing ? (
        <div>
          <textarea
            autoFocus
            aria-label="手动引注内容"
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void saveCustom();
              }
              if (e.key === "Escape") {
                e.stopPropagation();
                setEditing(false);
              }
            }}
            value={draft}
            maxLength={10000}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button disabled={!draft.trim()} onClick={() => saveCustom()}>
            保存引注
          </button>
          <button onClick={() => setEditing(false)}>取消编辑</button>
        </div>
      ) : (
        <p
          className="citation-text editable-citation"
          tabIndex={0}
          title="双击修改引注（或按 Enter）"
          onDoubleClick={() => {
            setDraft(citationText);
            setEditing(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setDraft(citationText);
              setEditing(true);
            }
          }}
        >
          {citationText}
        </p>
      )}
      {override && (
        <small>
          当前格式使用手动引注，修改来源后请同步核对；其他格式独立保存。
        </small>
      )}
      {result.missing.length > 0 && (
        <small className="amber">
          待补全：{result.missing.join("、")}。请在“来源”中补全并保存。
        </small>
      )}
      <small>自动引注，请核对来源信息与引证页。{message}</small>
      <details className="citation-credits">
        <summary>样式来源与许可</summary>
        <small>
          引注由 citeproc-js 提供，Copyright © 2009–2019 Frank
          Bennett（CPAL-1.0）；https://github.com/Juris-M/citeproc-js
          。法学样式：Zeping Lee / zotero-chinese；GB/T、APA 及语言文件：CSL
          项目，CC BY-SA 3.0。样式与作者信息随应用保留。
        </small>
      </details>
    </div>
  );
}
