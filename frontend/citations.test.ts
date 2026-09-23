import { it, expect } from "vitest";
import { formatCitation } from "./citations";
import type { Source } from "./types";
const source = {
  id: "one",
  title: "测试文献的引用格式示例",
  bibliography: {
    type: "journal",
    authors: "张三",
    journal: "示例法学期刊",
    year: "2026",
    issue: "3",
    pages: "141-154",
    cited_page: "142",
  },
} as Pick<Source, "id" | "title" | "bibliography">;
it("renders legal handbook citation using the supplied CSL", () => {
  const r = formatCitation(source);
  console.log(r.text);
  expect(r.text).toContain("张三");
  expect(r.text).toContain("示例法学期刊");
  expect(r.text).toContain("142");
  expect(r.missing).toEqual([]);
});
it("renders GB/T and APA bibliography with synthetic metadata", () => {
  const gb = formatCitation(source, "gbt").text,
    apa = formatCitation(source, "apa").text;
  console.log(gb, apa);
  expect(gb).toContain("[J]");
  expect(gb).toContain("141-154");
  expect(apa).toContain("2026");
  expect(apa).not.toBe(gb);
});
it("reports missing metadata without inventing it", () => {
  const r = formatCitation({ ...source, bibliography: { type: "journal" } });
  expect(r.missing).toContain("作者");
  expect(r.text).not.toContain("张三");
});

