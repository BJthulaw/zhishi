import { _electron as electron } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(".");
const profile = resolve(".smoke-profile", String(Date.now()));
await mkdir(profile, { recursive: true });
const options = {
  ...(process.env.ZHISHI_PACKAGED
    ? { executablePath: resolve(process.env.ZHISHI_PACKAGED), args: [] }
    : { args: ["."] }),
  cwd: root,
  env: {
    ...process.env,
    ZHISHI_TEST_DEBUG: "1",
    ZHISHI_PROFILE: profile,
    ZHISHI_LIBRARY: resolve(profile, "library"),
  },
  timeout: 60000,
};
const application = await electron.launch(options);
application.process().stderr.on("data", (chunk) => process.stderr.write(chunk));
try {
  const page = await application.firstWindow({ timeout: 60000 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page
    .getByRole("button", { name: "收录文献", exact: false })
    .first()
    .waitFor({ timeout: 30000 });
  await page
    .getByRole("button", { name: "收录文献", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "记录文字" }).click();
  await page
    .getByLabel("收录内容")
    .fill(
      "个人信息保护法通过知情同意保障隐私与个人权利。自动化决策应遵循算法公平和算法可问责要求。\n\n个人信息处理的合法性基础不能仅依赖形式同意。",
    );
  await page.getByRole("button", { name: "保存到资料库" }).click();
  await page.getByText("文件第", { exact: false }).count();
  await page
    .locator(".content-block .body-text")
    .first()
    .waitFor({ timeout: 120000 });
  await page.getByRole("button", { name: "笔记", exact: true }).click();
  await page
    .getByLabel("笔记正文")
    .fill("研究笔记：比较自动化决策与知情同意的关系。");
  await page.getByRole("button", { name: "保存笔记", exact: true }).click();
  await page.getByText("笔记已保存", { exact: true }).waitFor();
  await page.getByRole("button", { name: "证据问答", exact: true }).click();
  await page.getByLabel("研究问题").fill("知情同意");
  await page.getByRole("button", { name: "检索证据", exact: true }).click();
  await page
    .getByRole("button", { name: "核对原文", exact: false })
    .first()
    .waitFor({ timeout: 15000 });
  await page
    .getByRole("button", { name: "核对原文", exact: false })
    .first()
    .click();
  await page.locator(".content-block.focused").waitFor();
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({
    path: "docs/screenshots/desktop-library.png",
    fullPage: true,
  });
  const fixtureNames = [
    "测试PDF.pdf",
    "测试Word.docx",
    "测试Excel.xlsx",
    "测试图片.png",
  ];
  await application.evaluate(
    ({ dialog }, files) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: files,
      });
    },
    fixtureNames.map((name) => resolve(".smoke-fixtures", name)),
  );
  const imports = await page.evaluate(() => window.zhishi.importFiles());
  let completed = [];
  for (let attempt = 0; attempt < 240; attempt++) {
    completed = await page.evaluate(() => window.zhishi.listJobs());
    if (
      imports.every((item) =>
        completed.some(
          (job) =>
            job.id === item.job_id &&
            !["running", "queued"].includes(job.state),
        ),
      )
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (completed.some((job) => ["running", "queued"].includes(job.state)))
    throw Error("Parser jobs timed out: " + JSON.stringify(completed));
  if (completed.some((j) => j.state === "failed"))
    throw Error(JSON.stringify(completed));
  const pdf = await page.evaluate(
    (id) => window.zhishi.getSource({ id }),
    imports[0].source_id,
  );
  if (!pdf.blocks.some((b) => b.raw.includes("知情同意")))
    throw Error("PDF text missing");
  await page.getByRole("button", { name: "全部文献", exact: true }).click();
  await page.locator(".source-card").filter({ hasText: "测试PDF" }).click();
  await page.getByRole("button", { name: "原件", exact: true }).click();
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector(".pdf-view canvas");
      return canvas && canvas.width > 300;
    },
    null,
    { timeout: 30000 },
  );
  await page.screenshot({
    path: "docs/screenshots/desktop-pdf.png",
    fullPage: true,
  });
  await page.locator(".source-card").filter({ hasText: "测试Excel" }).click();
  await page.getByRole("cell", { name: "=B2+1（未计算）", exact: true }).waitFor();
  await page.screenshot({
    path: "docs/screenshots/desktop-table.png",
    fullPage: true,
  });
  await page.locator(".source-card").filter({ hasText: "测试图片" }).click();
  await page.waitForFunction(
    () => {
      const image = document.querySelector(".block-image");
      return image && image.complete && image.naturalWidth > 0;
    },
    null,
    { timeout: 15000 },
  );
  const health = await page.evaluate(() => window.zhishi.health());
  const notes = await page.evaluate(() => window.zhishi.listNotes());
  if (notes.length !== 1) throw Error("Note did not persist");
  if (errors.length) throw Error(errors.join("\n"));
  const result = {
    status: "passed",
    health,
    notes: notes.length,
    formats: ["txt", "pdf", "docx", "xlsx", "png"],
    rendererErrors: errors,
    profile,
  };
  await writeFile("docs/desktop-smoke.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  const page = application.windows()[0];
  if (page) {
    await mkdir("docs/screenshots", { recursive: true });
    await page.screenshot({ path: "docs/screenshots/smoke-failure.png" });
    console.error(await page.locator("body").innerText());
  }
  throw error;
} finally {
  await application.close();
}

const restarted = await electron.launch(options);
try {
  const page = await restarted.firstWindow();
  await page.getByRole("button", { name: "我的笔记", exact: true }).waitFor();
  await page.getByRole("button", { name: "我的笔记", exact: true }).click();
  await page
    .getByText("研究笔记：比较自动化决策与知情同意的关系。", { exact: true })
    .waitFor();
  console.log("Restart persistence passed");
} finally {
  await restarted.close();
}
