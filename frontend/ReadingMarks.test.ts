import { it, expect } from "vitest";
import { textSegments } from "./ReadingMarks";
import type { Highlight } from "./types";
const mark = {
  id: "1",
  block_id: "b",
  parse_revision: 1,
  start: 0,
  end: 3,
  text: "甲乙丙",
  view: "clean",
  style: "bold",
} as Highlight;
it("renders overlapping marks without changing original text", () => {
  const parts = textSegments("甲乙丙丁", [
    mark,
    { ...mark, id: "2", start: 1, end: 4, text: "乙丙丁", style: "purple" },
  ]);
  expect(parts.map((p) => p.text).join("")).toBe("甲乙丙丁");
  expect(parts[1].styles).toEqual(["bold", "purple"]);
});
it("does not apply stale offsets to changed text", () => {
  expect(textSegments("甲新乙丙丁", [mark])).toEqual([
    { text: "甲新乙丙丁", styles: [] },
  ]);
});
it("supports UTF16 selection offsets for non-BMP characters", () => {
  expect(
    textSegments("甲😀乙", [{ ...mark, start: 1, end: 3, text: "😀" }])[1],
  ).toEqual({ text: "😀", styles: ["bold"] });
});
