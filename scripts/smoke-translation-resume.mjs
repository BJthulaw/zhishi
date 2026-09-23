import { _electron as electron } from "playwright";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import assert from "node:assert/strict";
const calls = [];
let held;
const server = createServer((req, res) => {
  let data = "";
  req.on("data", (d) => (data += d));
  req.on("end", () => {
    const p = JSON.parse(JSON.parse(data).messages[1].content);
    calls.push(p.segments.map((s) => s.id));
    if (calls.length === 2) {
      held = res;
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                translations: p.segments.map((s) => ({
                  id: s.id,
                  text: `已保存中文译文${s.id}。`,
                })),
              }),
            },
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 100,
          total_tokens: 200,
        },
      }),
    );
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const profile = resolve(".smoke-profile", `resume-${Date.now()}`);
await mkdir(profile, { recursive: true });
const opts = {
  ...(process.env.ZHISHI_PACKAGED
    ? { executablePath: resolve(process.env.ZHISHI_PACKAGED), args: [] }
    : { args: ["."] }),
  cwd: resolve("."),
  env: {
    ...process.env,
    ZHISHI_PROFILE: profile,
    ZHISHI_LIBRARY: resolve(profile, "library"),
  },
  timeout: 60000,
};
let app = await electron.launch(opts);
try {
  let page = await app.firstWindow();
  await page.getByRole("button", { name: "全部文献", exact: true }).waitFor();
  const src = await page.evaluate(() =>
    window.zhishi.ingestText({
      title: "Translation checkpoint test",
      text: Array.from(
        { length: 4 },
        (_, i) =>
          `Paragraph ${i}: ` +
          "Public data requires accountable governance and clear rights. ".repeat(
            22,
          ),
      ).join("\n\n"),
    }),
  );
  for (let i = 0; i < 200; i++) {
    const s = await page.evaluate(
      (id) => window.zhishi.getSource({ id }),
      src.source_id,
    );
    if (s.parse_status === "succeeded") break;
    await page.waitForTimeout(100);
  }
  await page.evaluate(
    (base) =>
      window.zhishi.saveProvider({
        base_url: base,
        model: "mock",
        key: "fake",
        enabled: true,
        translation: true,
      }),
    `http://127.0.0.1:${server.address().port}/v1`,
  );
  await page.reload();
  await page.locator(".source-card").first().click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "LLM 逐段翻译", exact: true }).click();
  await page
    .locator(".parallel-reader")
    .getByText("已保存中文译文0。", { exact: true })
    .waitFor();
  // The UI may display the checkpoint before the next HTTP request starts.
  for (let i = 0; i < 300 && !held; i++) await page.waitForTimeout(100);
  assert(held, "The second translation batch should reach the mock server");
  const partial = await page.evaluate(
    (id) => window.zhishi.getSource({ id }),
    src.source_id,
  );
  assert(
    partial.translation.completed > 0 &&
      partial.translation.completed < partial.translation.total,
  );
  const running = await page.evaluate(() => window.zhishi.listJobs());
  assert(
    running.some((j) => j.stage === "translation" && j.state === "running"),
  );
  await page.screenshot({ path: "docs/screenshots/translation-progress.png" });
  held.writeHead(500);
  held.end("simulated failure");
  held = null;
  for (let i = 0; i < 300; i++) {
    const jobs = await page.evaluate(() => window.zhishi.listJobs());
    if (jobs.some((j) => j.stage === "translation" && j.state === "failed"))
      break;
    await page.waitForTimeout(100);
  }
  await app.close();
  app = await electron.launch(opts);
  page = await app.firstWindow();
  await page.getByRole("button", { name: "全部文献", exact: true }).waitFor();
  await page.locator(".source-card").first().click();
  await page.getByRole("button", { name: "中英对照", exact: true }).click();
  await page
    .locator(".parallel-reader")
    .getByText("已保存中文译文0。", { exact: true })
    .waitFor();
  const before = calls.length;
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "LLM 逐段翻译", exact: true }).click();
  for (let i = 0; i < 300; i++) {
    const s = await page.evaluate(
      (id) => window.zhishi.getSource({ id }),
      src.source_id,
    );
    if (s.translation.status === "complete") break;
    await page.waitForTimeout(100);
  }
  const completedIds = new Set(partial.translation.segments.map((s) => s.id));
  assert(
    calls
      .slice(before)
      .flat()
      .every((id) => !completedIds.has(id)),
  );
  const completed = await page.evaluate(
    (id) => window.zhishi.getSource({ id }),
    src.source_id,
  );
  assert(completed.translation.paragraphs.every((p) => p.text && p.complete));
  await writeFile(
    "docs/translation-resume-smoke.json",
    JSON.stringify(
      {
        status: "passed",
        build: process.env.ZHISHI_PACKAGED ? "packaged" : "development",
        realModelCalls: 0,
        calls,
        partialSaved: partial.translation.completed,
        total: partial.translation.total,
        checks: [
          "partial visible while next request is pending",
          "persisted before task completes",
          "partial survives HTTP failure and app restart",
          "explicit resume retries unfinished request",
          "saved segments never resent",
        ],
      },
      null,
      2,
    ),
  );
  console.log("Translation checkpoint and resume smoke passed");
} finally {
  if (held) {
    held.writeHead(500);
    held.end();
  }
  await app.close();
  server.close();
}
