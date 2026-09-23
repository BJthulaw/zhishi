import { describe, it, expect } from "vitest";
import { summarizeUsage, UsageRow } from "./usage";
const row = (extra: Partial<UsageRow> = {}): UsageRow => ({
  id: "1",
  day: "2026-09-19",
  state: "settled",
  estimated_input_tokens: 20,
  estimated_output_tokens: 3000,
  operation: "answers",
  prompt_tokens: 10,
  completion_tokens: 5,
  total_tokens: 15,
  ...extra,
});
describe("LLM usage totals", () => {
  it("filters inclusive dates and separates unknown tokens and reserved cost", () => {
    const s = summarizeUsage(
      [
        row(),
        row({
          id: "2",
          total_tokens: null,
          prompt_tokens: null,
          completion_tokens: null,
          state: "usage_unknown",
        }),
        row({ day: "2026-08-01" }),
      ],
      "2026-09-19",
      "2026-09-19",
    );
    expect(s.calls).toBe(2);
    expect(s.input).toBe(10);
    expect(s.output).toBe(5);
    expect(s.total).toBe(15);
    expect(s.unknownTokens).toBe(1);
    expect(s.estimatedInput).toBe(40);
    expect(s.outputLimit).toBe(6000);
    expect(s.tasks[0]).toEqual({
      operation: "answers",
      calls: 2,
      total: 15,
      unknown: 1,
    });
  });
  it("counts all records beyond the display limit", () =>
    expect(summarizeUsage(Array.from({ length: 105 }, () => row())).calls).toBe(
      105,
    ));
  it("supports empty history", () => expect(summarizeUsage([]).total).toBe(0));
});
