/// <reference types="vite/client" />
export type Topic = { id: string; name: string; scope: string; count: number };
export type Block = {
  id: string;
  type: string;
  raw: string;
  clean: string;
  layout_role?: string;
  decorative?: boolean;
  locator: Record<string, unknown>;
  asset?: string;
  rows?: string[][];
  cells?: {
    coordinate: string;
    value: string;
    formula: string | null;
    cached: boolean;
  }[];
  merged?: string[];
};
export type Highlight = {
  id: string;
  block_id: string;
  parse_revision: number;
  start: number;
  end: number;
  text: string;
  view: "raw" | "clean";
  style: "underline" | "bold" | "purple";
};
export type Source = {
  translation?: {
    parse_revision: number;
    model: string;
    status?: string;
    completed?: number;
    total?: number;
    paragraphs: {
      block_id: string;
      original: string;
      text: string;
      complete?: boolean;
    }[];
  };
  highlights?: Highlight[];
  id: string;
  revision: number;
  title: string;
  filename: string;
  kind: string;
  hash: string;
  created_at: string;
  parse_revision: number;
  asset_revision?: number;
  parse_status: string;
  parse_error?: string;
  archive_status: string;
  semantic_status: string;
  topic_ids: string[];
  primary_topic_id: string | null;
  confirmed: boolean;
  tags: string[];
  blocks: Block[];
  coverage?: { total: number; parsed: number; complete: boolean; unit: string };
  warnings: string[];
  summary: {
    mode?: string;
    text?: string;
    label?: string;
    keywords?: string[];
    evidence_ids?: string[];
  };
  classification?: {
    reason: string;
    candidates: { id: string; name: string; score: number; reason: string }[];
  };
  bibliography: Record<string, string>;
};
export type Note = {
  source_deleted?: boolean;
  id: string;
  revision: number;
  source_id: string;
  block_id?: string;
  markdown: string;
  quote: string;
  draft: boolean;
  updated_at: string;
};
export type Evidence = {
  id: string;
  source_id: string;
  block_id: string;
  parse_revision: number;
  source_revision: number;
  title: string;
  quote: string;
  locator: Record<string, unknown>;
};
export type Answer = {
  answer_reason?: string;
  scope?: { cloud?: boolean };
  id: string;
  question: string;
  message: string;
  status: string;
  evidence: Evidence[];
  claims: {
    quote: string;
    evidence_id: string;
    evidence_ids?: string[];
    text?: string;
    kind?: string;
  }[];
  stale?: boolean;
};
export type Job = {
  id: string;
  source_id: string;
  stage: string;
  state: string;
  error: string;
};
export type Bridge = Record<
  string,
  (payload?: Record<string, unknown>) => Promise<any>
>;
declare global {
  interface Window {
    zhishi: Bridge;
  }
}
export const api =
  typeof window === "undefined" ? ({} as Bridge) : window.zhishi;
export function locationLabel(locator: Record<string, unknown>) {
  if (locator.ocr)
    return `OCR 衍生文字 · 文件第 ${Number(locator.page_index) + 1} 页 · 请核对原件`;
  if (typeof locator.page_index === "number")
    return (
      `文件第 ${locator.page_index + 1} 页` +
      (locator.printed_page
        ? ` · 印刷页 ${locator.printed_page}`
        : " · 印刷页未核对")
    );
  if (locator.sheet) return `${locator.sheet} · ${locator.range || ""}`;
  if (locator.footnote) return `脚注 ${locator.footnote}`;
  if (locator.manual_transcription) return "人工补充正文 · 待与原件核对";
  return locator.paragraph
    ? `段落 ${locator.paragraph}`
    : locator.anchor
      ? String(locator.anchor)
      : "图片";
}
export const stateLabel: Record<string, string> = {
  queued: "排队中",
  running: "处理中",
  succeeded: "已完成",
  failed: "处理失败",
  cancelled: "已取消",
  interrupted: "已中断",
  needs_ocr: "待 OCR / 核对",
  needs_review: "待人工核对",
  local_only: "本地提炼",
  not_requested: "未调用模型",
  saved: "已存档",
};
