import CSL from "citeproc";
import legal from "./csl/legal.csl?raw";
import gbt from "./csl/gbt.csl?raw";
import apa from "./csl/apa.csl?raw";
import zh from "./csl/locales-zh-CN.xml?raw";
import en from "./csl/locales-en-US.xml?raw";
import type { Source } from "./types";

export const citationStyles = {
  legal: "《法学引注手册》",
  gbt: "GB/T 7714—2015",
  apa: "APA（第7版）",
};
export type CitationStyle = keyof typeof citationStyles;
export function formatCitation(
  source: Pick<Source, "id" | "title" | "bibliography">,
  style: CitationStyle = "legal",
) {
  const b = source.bibliography;
  const type =
    (
      {
        journal: "article-journal",
        book: "book",
        web: "webpage",
        law: "legislation",
        case: "legal_case",
      } as Record<string, string>
    )[b.type] || "document";
  const author = (b.authors || b.author || "")
    .split(/[;；、\n]+/)
    .filter(Boolean)
    .map((name) => {
      name = name.trim();
      if (/[\u4e00-\u9fff]/.test(name)) return { literal: name };
      if (name.includes(",")) {
        const [family, ...given] = name.split(",");
        return { family: family.trim(), given: given.join(",").trim() };
      }
      const parts = name.split(/\s+/);
      return parts.length > 1
        ? { family: parts.pop(), given: parts.join(" ") }
        : { literal: name };
    });
  const date = (value: string) => {
    const parts = value?.match(/\d+/g)?.slice(0, 3).map(Number);
    return parts?.length ? { "date-parts": [parts] } : undefined;
  };
  const item = {
    id: source.id,
    type,
    title: source.title,
    author,
    language: /[\u4e00-\u9fff]/.test(source.title) ? "zh-CN" : "en-US",
    "container-title": b.journal || b.website,
    publisher: b.publisher,
    "publisher-place": b.place,
    volume: b.volume,
    issue: b.issue,
    page: b.pages,
    edition: b.edition,
    DOI: b.doi,
    URL: b.url,
    issued: date(b.date || b.year),
    accessed: date(b.accessed),
    number: b.number,
    authority: b.authority,
  };
  const engine = new CSL.Engine(
    {
      retrieveLocale: (lang: string) => (lang.startsWith("zh") ? zh : en),
      retrieveItem: () => item,
    },
    { legal, gbt, apa }[style],
    style === "apa" ? "en-US" : "zh-CN",
  );
  engine.setOutputFormat("text");
  engine.updateItems([source.id]);
  let text: string;
  if (style === "legal") {
    text = engine.previewCitationCluster(
      {
        citationItems: [
          {
            id: source.id,
            ...(b.cited_page
              ? { locator: b.cited_page || b.pages, label: "page" }
              : {}),
          },
        ],
        properties: { noteIndex: 1 },
      },
      [],
      [],
      "text",
    );
  } else {
    const bibliography = engine.makeBibliography();
    text = bibliography?.[1]?.join("").trim() || "";
  }
  const labels: Record<string, string> = {
    authors: "作者",
    journal: "刊名",
    year: "年份",
    pages: "起止页码",
    publisher: "出版社",
    url: "网址",
    date: "日期",
    type: "文献类型",
  };
  const required =
    b.type === "journal"
      ? ["authors", "journal", "year", "pages"]
      : b.type === "book"
        ? ["authors", "publisher", "year"]
        : b.type === "web"
          ? ["authors", "url", "date"]
          : ["type"];
  return {
    text: text.trim(),
    missing: required
      .filter((k) => !b[k] || (k === "type" && b.type === "excerpt"))
      .map((k) => labels[k]),
  };
}
