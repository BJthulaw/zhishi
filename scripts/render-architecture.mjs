import { chromium } from "playwright";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const dir = resolve("docs/architecture");
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 2000, height: 1000 }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(resolve(dir, "知拾-总体架构.svg")).href);
  await page.evaluate(() => document.fonts.ready);
  const checks = await page.evaluate(() => {
    const svg = document.querySelector("svg");
    const outside = [...svg.querySelectorAll("text")].filter(t => {
      const b = t.getBBox();
      return b.x < 0 || b.y < 0 || b.x + b.width > 2000 || b.y + b.height > 1000;
    }).map(t => t.textContent);
    return { ratio: svg.viewBox.baseVal.width / svg.viewBox.baseVal.height, outside };
  });
  assert.equal(checks.ratio, 2);
  assert.deepEqual(checks.outside, []);
  await page.screenshot({ path: resolve(dir, "知拾-总体架构.png") });
  await writeFile(resolve(dir, "validation.json"), JSON.stringify({ ...checks, png: "4000 × 2000", source: "v0.1.11 implementation", visual_review: "pending" }, null, 2));
  console.log("Architecture geometry and 16:8 ratio checks passed");
} finally { await browser.close(); }
