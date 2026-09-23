import { _electron as electron } from "playwright";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import assert from "node:assert/strict";
let calls = 0;
const summary =
  "本文讨论数据治理中的权利保护与制度设计，围绕个人信息处理的合法性与问责要求展开分析。文章强调，应将数据利用的目标与保障个人权利的程序结合起来，避免仅以形式同意代替实质保护。".repeat(
    3,
  );
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    calls++;
    const request = JSON.parse(body),
      payload = JSON.parse(request.messages[1].content);
    const result = payload.segments
      ? {
          translations: payload.segments.map((s) => ({
            id: s.id,
            text: `中文译文${s.id}：数据治理必须保护个人权利，并确保问责。`,
          })),
        }
      : payload.blocks
        ? {
            quotes: payload.blocks.map((b) => ({
              block_id: b.id,
              quote: b.raw,
            })),
          }
        : { summary: summary.replaceAll("。", "。\n") };
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(result) } }],
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
const profile = resolve(".smoke-profile", `translation-${Date.now()}`);
await mkdir(profile, { recursive: true });
const options = {
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
let app = await electron.launch(options);
try {
  let page = await app.firstWindow();
  await page.getByRole("button", { name: "全部文献", exact: true }).waitFor();
  const source = await page.evaluate(() =>
    window.zhishi.ingestText({
      title: "Wrong extracted title",
      text: "This paper examines the legal protection of personal\n information and accountability in data governance.\n\nThe authors argue that rights and procedures must be considered together in the practical application of data protection rules.",
    }),
  );
  const waitTasks = async () => {
    for (let i = 0; i < 300; i++) {
      const jobs = await page.evaluate(() => window.zhishi.listJobs());
      if (jobs.some((j) => j.state === "failed"))
        throw Error(JSON.stringify(jobs));
      if (jobs.length && jobs.every((j) => j.state === "succeeded")) return;
      await page.waitForTimeout(200);
    }
    throw Error("task timeout");
  };
  await waitTasks();
  await page.locator(".source-card").first().click();
  assert.equal(calls, 0);
  await page.getByRole("button", { name: "中英对照", exact: true }).click();
  await page.getByText("当前正文尚无译文", { exact: false }).waitFor();
  assert.equal(calls, 0);
  await page.evaluate(
    (base) =>
      window.zhishi.saveProvider({
        base_url: base,
        model: "mock-text",
        key: "fake",
        enabled: true,
        translation: true,
        summary: true,
      }),
    `http://127.0.0.1:${server.address().port}/v1`,
  );
  await page.reload();
  await page.getByRole("button", { name: "全部文献", exact: true }).waitFor();
  await page.locator(".source-card").first().click();
  await page.getByRole("button", { name: "中英对照", exact: true }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "LLM 逐段翻译", exact: true }).click();
  await waitTasks();
  await page.locator(".parallel-paragraph").first().waitFor();
  assert.equal(await page.locator(".parallel-paragraph").count(), 2);
  const translated = await page.evaluate(
    (id) => window.zhishi.getSource({ id }),
    source.source_id,
  );
  assert.equal(translated.translation.paragraphs.length, 2);
  const usage = await page.evaluate(() => window.zhishi.usage());
  assert(usage.some((x) => x.operation === "translation"));
  await page.getByRole("button", { name: "放大阅读", exact: true }).click();
  await page.screenshot({ path: "docs/screenshots/parallel-reading.png" });
  await page.keyboard.press("Escape");
  await page.locator(".reader-title h2").dblclick();
  await page.getByLabel("修改文献标题").fill("Corrected Research Title");
  await page.getByRole("button", { name: "保存标题", exact: true }).click();
  await page
    .locator(".reader-title h2")
    .filter({ hasText: "Corrected Research Title" })
    .waitFor();
  await page.locator(".citation-text").dblclick();
  await page
    .getByLabel("手动引注内容")
    .fill("自定义法学引注：作者，文献，2026年。");
  await page.getByRole("button", { name: "保存引注", exact: true }).click();
  await page
    .locator(".citation-text")
    .filter({ hasText: "自定义法学引注" })
    .waitFor();
  await page.getByRole("button", { name: "APA（第7版）", exact: true }).click();
  assert(
    !(await page.locator(".citation-text").innerText()).includes(
      "自定义法学引注",
    ),
  );
  await page
    .getByRole("button", { name: "《法学引注手册》", exact: true })
    .click();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "生成约300字摘要", exact: true })
    .click();
  await waitTasks();
  await page.waitForFunction(() =>
    document.querySelector(".summary-editor").value.startsWith("本文讨论"),
  );
  assert(!(await page.locator(".summary-editor").inputValue()).includes("\n"));
  await app.close();
  app = await electron.launch(options);
  page = await app.firstWindow();
  await page.getByRole("button", { name: "全部文献", exact: true }).waitFor();
  await page.locator(".source-card").first().click();
  await page
    .locator(".citation-text")
    .filter({ hasText: "自定义法学引注" })
    .waitFor();
  assert.equal(
    await page.locator(".reader-title h2").innerText(),
    "Corrected Research Title",
  );
  const before = calls;
  await page.getByRole("button", { name: "中英对照", exact: true }).click();
  await page.locator(".parallel-paragraph").first().waitFor();
  assert.equal(calls, before);
  await page.getByRole("button", { name: "恢复自动引注", exact: true }).click();
  await page.getByText("已恢复自动引注", { exact: false }).waitFor();
  await writeFile(
    "docs/translation-smoke.json",
    JSON.stringify(
      {
        status: "passed",
        build: process.env.ZHISHI_PACKAGED ? "packaged" : "development",
        realModelCalls: 0,
        mockCalls: calls,
        checks: [
          "no automatic model calls",
          "manual translation with permission",
          "two aligned paragraphs",
          "translation token task",
          "single paragraph model summary",
          "title correction",
          "independent manual citations",
          "restart persistence",
          "restore automatic citation",
        ],
      },
      null,
      2,
    ),
  );
  console.log("Translation, summary and metadata smoke passed");
} finally {
  await app.close();
  server.close();
}
