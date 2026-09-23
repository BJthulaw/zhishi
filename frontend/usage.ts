export type UsageRow = {
  id: string;
  day: string;
  created?: string;
  operation?: string;
  model?: string;
  endpoint?: string;
  state: string;
  source_id?: string;
  estimated_input_tokens?: number | null;
  estimated_output_tokens?: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
};
export function summarizeUsage(rows: UsageRow[], from = "", to = "") {
  const records = rows.filter(
    (r) => (!from || r.day >= from) && (!to || r.day <= to),
  );
  return {
    records,
    calls: records.length,
    input: records.reduce((s, r) => s + (r.prompt_tokens ?? 0), 0),
    output: records.reduce((s, r) => s + (r.completion_tokens ?? 0), 0),
    total: records.reduce((s, r) => s + (r.total_tokens ?? 0), 0),
    unknownTokens: records.filter((r) => r.total_tokens == null).length,
    estimatedInput: records.reduce(
      (s, r) => s + (r.estimated_input_tokens ?? 0),
      0,
    ),
    outputLimit: records.reduce(
      (s, r) => s + (r.estimated_output_tokens ?? 0),
      0,
    ),
    tasks: Array.from(
      new Set(records.map((r) => r.operation || "unknown")),
    ).map((operation) => {
      const group = records.filter(
        (r) => (r.operation || "unknown") === operation,
      );
      return {
        operation,
        calls: group.length,
        total: group.reduce((s, r) => s + (r.total_tokens ?? 0), 0),
        unknown: group.filter((r) => r.total_tokens == null).length,
      };
    }),
  };
}
