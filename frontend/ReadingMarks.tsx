import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, type Highlight, type Source } from "./types";
const Marks = createContext<Highlight[]>([]);
export function textSegments(text: string, marks: Highlight[]) {
  const valid = marks.filter(
    (m) =>
      m.start >= 0 &&
      m.end <= text.length &&
      text.slice(m.start, m.end) === m.text,
  );
  const cuts = [
    ...new Set([0, text.length, ...valid.flatMap((m) => [m.start, m.end])]),
  ].sort((a, b) => a - b);
  return cuts
    .slice(0, -1)
    .map((start, i) => ({
      text: text.slice(start, cuts[i + 1]),
      styles: [
        ...new Set(
          valid
            .filter((m) => m.start <= start && m.end >= cuts[i + 1])
            .map((m) => m.style),
        ),
      ],
    }));
}
export function MarkedText({
  text,
  blockId,
  raw,
  revision,
}: {
  text: string;
  blockId: string;
  raw: boolean;
  revision: number;
}) {
  const marks = useContext(Marks).filter(
    (m) =>
      m.block_id === blockId &&
      m.parse_revision === revision &&
      m.view === (raw ? "raw" : "clean"),
  );
  return (
    <span data-mark-block={blockId}>
      {textSegments(text, marks).map((part, i) => (
        <span key={i} className={part.styles.map((s) => `mark-${s}`).join(" ")}>
          {part.text}
        </span>
      ))}
    </span>
  );
}
export default function ReadingMarks({
  source,
  raw,
  onSaved,
  children,
}: {
  source: Source;
  raw: boolean;
  onSaved: (s: Source) => void;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<Omit<Highlight, "id" | "style">[]>(
    [],
  );
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setSelection([]);
    setMessage("");
  }, [source.id, source.parse_revision, raw]);
  useEffect(() => {
    const capture = () => {
      const s = window.getSelection();
      if (!s?.rangeCount || s.isCollapsed || !root.current) {
        setSelection([]);
        return;
      }
      const range = s.getRangeAt(0);
      const found: Omit<Highlight, "id" | "style">[] = [];
      root.current
        .querySelectorAll<HTMLElement>("[data-mark-block]")
        .forEach((el) => {
          if (!range.intersectsNode(el)) return;
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let node: Node | null;
          let offset = 0;
          let start = -1;
          let end = 0;
          while ((node = walker.nextNode())) {
            const length = node.textContent?.length || 0;
            if (range.intersectsNode(node)) {
              const a = node === range.startContainer ? range.startOffset : 0;
              const b = node === range.endContainer ? range.endOffset : length;
              if (b > a) {
                if (start < 0) start = offset + a;
                end = offset + b;
              }
            }
            offset += length;
          }
          if (start >= 0 && end > start)
            found.push({
              block_id: el.dataset.markBlock!,
              parse_revision: source.parse_revision,
              start,
              end,
              text: el.textContent!.slice(start, end),
              view: raw ? "raw" : "clean",
            });
        });
      setSelection(found);
    };
    document.addEventListener("selectionchange", capture);
    return () => document.removeEventListener("selectionchange", capture);
  }, [source.id, source.parse_revision, raw]);
  async function save(style: Highlight["style"] | "clear") {
    if (!selection.length || saving) return;
    setSaving(true);
    setMessage("");
    try {
      let marks = source.highlights || [];
      if (style === "clear")
        marks = marks.filter(
          (m) =>
            !selection.some(
              (s) =>
                s.block_id === m.block_id &&
                s.view === m.view &&
                s.parse_revision === m.parse_revision &&
                s.start < m.end &&
                s.end > m.start,
            ),
        );
      else
        marks = [
          ...marks,
          ...selection.map((s) => ({ ...s, id: crypto.randomUUID(), style })),
        ];
      const updated = await api.saveHighlights({
        id: source.id,
        expected_revision: source.revision,
        highlights: marks,
      });
      onSaved(updated);
      setMessage(style === "clear" ? "已清除选区相交的标记" : "标记已保存");
    } catch (e) {
      setMessage(`保存失败：${String(e)}`);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Marks.Provider value={source.highlights || []}>
      <div className="mark-toolbar" role="toolbar" aria-label="正文标记">
        <span>选中文字后标记</span>
        {(
          [
            ["underline", "划线"],
            ["bold", "加粗"],
            ["purple", "紫色标记"],
            ["clear", "清除标记"],
          ] as const
        ).map(([style, label]) => (
          <button
            key={style}
            disabled={!selection.length || saving}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => save(style)}
          >
            {label}
          </button>
        ))}
        <small role="status">{saving ? "保存中…" : message}</small>
      </div>
      <div ref={root}>{children}</div>
    </Marks.Provider>
  );
}
