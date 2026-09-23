import { describe, it, expect } from "vitest";
import { displayPDFText, readingParagraphs } from "./PDFCleanReader";
import { presets } from "./ProviderGuide";
describe("PDF clean view and provider presets", () => {
  it("removes fixed-layout soft wraps without mutating evidence", () => {
    const raw = "intergovernmental \nmarketplace in individual data.\x08";
    expect(displayPDFText(raw)).toBe(
      "intergovernmental marketplace in individual data.",
    );
    expect(raw).toContain("\n");
  });
  it("repairs split words and decorative leaders", () =>
    expect(displayPDFText("feu-\ndalism ........")).toBe("feudalism"));
  it("uses compatible DashScope endpoint and accurate model identifiers", () => {
    expect(presets[0].base).toMatch(/compatible-mode\/v1$/);
    expect(presets[0].model).toBe("qwen-plus");
    expect(presets[2].base).toBe("https://api.deepseek.com");
  });
});

it("rejoins drop caps and author affiliation fragments without changing source evidence", () => {
  const blocks = [
    { id: "a", type: "text", raw: "I", clean: "I", locator: { page_index: 0 } },
    {
      id: "b",
      type: "text",
      raw: "n this message",
      clean: "n this message",
      locator: { page_index: 0 },
    },
  ];
  const result = readingParagraphs(blocks);
  expect(result[1].clean).toBe("In this message");
  expect(result[1].raw).toBe("n this message");
  expect(blocks[0].clean).toBe("I");
});
