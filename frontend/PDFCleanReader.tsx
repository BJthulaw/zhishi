import { MarkedText } from "./ReadingMarks";
import { useState } from "react";
import { Source, Block, locationLabel } from "./types";
export function displayPDFText(text: string) {
  if (text.trim().toUpperCase() === "SECTION TITLE") return "";
  return text
    .normalize("NFKC")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u200b\ufeff\ufffd]/g, "")
    .replace(/[.·_]{4,}/g, " ")
    .replace(/([A-Za-z])-\s*\n\s*(?=[a-z])/g, "$1")
    .replace(/([\u4e00-\u9fff]) *\n *(?=[\u4e00-\u9fff])/g, "$1")
    .replace(/[ \t]*\n[ \t]*/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}
export function readingParagraphs(blocks: Block[]) {
  const result = blocks.map((b) => ({
    ...b,
    clean: displayPDFText(b.clean ?? b.raw),
  }));
  for (let i = 0; i < result.length - 1; i++) {
    const a = result[i],
      b = result[i + 1];
    if (
      a.type !== "text" ||
      b.type !== "text" ||
      a.locator.page_index !== b.locator.page_index
    )
      continue;
    if (/^[A-Za-z]$/.test(a.clean) && /^[a-z]/.test(b.clean)) {
      b.clean = a.clean + b.clean;
      a.clean = "";
    } else if (a.clean && /^[,，]/.test(b.clean)) {
      a.clean += b.clean;
      b.clean = "";
    }
  }
  return result;
}
export default function PDFCleanReader({
  source,
  raw,
  focus,
  onExcerpt,
}: {
  source: Source;
  raw: boolean;
  focus: string;
  onExcerpt: (b: Block) => void;
}) {
  const [mode, setMode] = useState(
    localStorage.getItem("pdf-reading-mode") || "page",
  );
  const blocks = raw ? source.blocks : readingParagraphs(source.blocks);
  const pages = new Map<number, Block[]>();
  for (const b of blocks) {
    const n = Number(b.locator.page_index || 0);
    if (!pages.has(n)) pages.set(n, []);
    pages.get(n)!.push(b);
  }
  function render(b: Block) {
    const hidden =
      !raw &&
      focus !== b.id &&
      (b.layout_role === "margin" ||
        b.decorative ||
        (b.type === "text" && !displayPDFText(b.clean ?? b.raw)));
    if (hidden) return null;
    return (
      <article
        id={b.id}
        key={b.id}
        className={`content-block ${mode === "page" ? "page-paragraph" : ""} ${focus === b.id ? "focused" : ""}`}
      >
        <div className="block-meta">
          {mode === "paragraph" && <span>{locationLabel(b.locator)}</span>}
          {b.raw && (
            <button onClick={() => onExcerpt(b)} title="摘录到笔记">
              摘录
            </button>
          )}
        </div>
        {b.type === "image" ? (
          <img
            className="block-image"
            src={`zhishi-asset://source/${source.id}/assets/${source.asset_revision || source.parse_revision}/${b.asset}`}
          />
        ) : b.type === "table" ? (
          <div className="table-wrap">
            <table>
              <tbody>
                {b.rows?.map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (
                      <td key={j}>{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={`body-text ${raw ? "raw-pdf-text" : "clean-pdf-text"}`}>
            <MarkedText
              text={raw ? b.raw : displayPDFText(b.clean ?? b.raw)}
              blockId={b.id}
              raw={raw}
              revision={source.parse_revision}
            />
          </p>
        )}
      </article>
    );
  }
  return (
    <>
      <label className="field pdf-mode">
        整理方式
        <select
          aria-label="PDF整理方式"
          value={mode}
          onChange={(e) => {
            setMode(e.target.value);
            localStorage.setItem("pdf-reading-mode", e.target.value);
          }}
        >
          <option value="page">按页整理（推荐）</option>
          <option value="paragraph">按段落整理</option>
        </select>
      </label>
      <p className="hint">
        整理视图合并版面换行并隐藏页边标记、小装饰图；原件和原文保留。勾选“显示原始断行”可核对。
      </p>
      {mode === "page"
        ? [...pages]
            .sort((a, b) => a[0] - b[0])
            .map(([n, blocks]) => (
              <section className="pdf-clean-page" key={n}>
                <h3 className="pdf-page-heading">
                  {blocks.find((b) => b.locator.printed_page)?.locator
                    .printed_page
                    ? `第 ${blocks.find((b) => b.locator.printed_page)!.locator.printed_page} 页（原文印刷页码）`
                    : `文件第 ${n + 1} 页 · 未识别印刷页码`}
                </h3>
                {blocks.map(render)}
              </section>
            ))
        : blocks.map(render)}
    </>
  );
}
