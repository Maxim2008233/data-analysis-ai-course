// Сценарий 14 (мобильная ширина и компьютер: скриншоты, нет горизонтальной прокрутки, редактор пригоден),
// отсутствие ошибок в консоли на ключевых страницах и замер загрузки Pyodide.
import fs from "node:fs";
import path from "node:path";
import { test as base } from "@playwright/test";
import { test, expect } from "./helpers";

const PAGES: [string, string][] = [
  ["home", "/"],
  ["courses", "/courses"],
  ["course", "/course"],
  ["module", "/course/m01-numpy"],
  ["lesson", "/learn/m01-numpy/l05-masks"],
  ["task", "/learn/m01-numpy/l05-masks#m1-l5-t1"],
  ["tasks", "/tasks"],
  ["reference", "/reference"],
  ["profile", "/profile"],
  ["login", "/login"],
];

const SHOTS = path.join(process.cwd(), "reports", "screenshots");

for (const [label, viewport] of [
  ["mobile", { width: 390, height: 844 }],
  ["desktop", { width: 1366, height: 900 }],
] as const) {
  test(`14. ${label}: ключевые страницы без горизонтальной прокрутки и без ошибок в консоли`, async ({ page }) => {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`${page.url()}: ${m.text()}`);
    });
    page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));
    for (const [name, url] of PAGES) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `горизонтальная прокрутка на ${url}`).toBeLessThanOrEqual(1);
      await page.screenshot({ path: path.join(SHOTS, `${label}-${name}.png`), fullPage: false });
    }
    // редактор пригоден: можно поставить курсор и набрать код
    await page.goto("/learn/m01-numpy/l05-masks#m1-l5-t1");
    const editor = page.locator('[data-task-id="m1-l5-t1"] .cm-content');
    await editor.click();
    await page.keyboard.press("End");
    await page.keyboard.type("  # проверка ввода");
    await expect(editor).toContainText("проверка ввода");
    expect(errors, errors.join("\n")).toEqual([]);
  });
}

// Замер: первая загрузка Python с CDN и повторная из кэша браузера (настоящая сеть, без подмены файлов).
base("Замер загрузки Pyodide: первая и повторная", async ({ browser }) => {
  base.setTimeout(300_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  const runFirstExample = async () => {
    await page.goto("/learn/m01-numpy/l01-question-to-table");
    const step = await page.evaluate(() => (document.querySelector('[data-testid="runnable-example"]')?.closest("[data-step]") as HTMLElement)?.dataset.step);
    await page.goto(`/learn/m01-numpy/l01-question-to-table#step-${step}`);
    const ex = page.locator(`[data-step="${step}"] [data-testid="runnable-example"]`).first();
    const t0 = Date.now();
    await ex.getByTestId("run-example").click();
    await expect(ex.getByTestId("output")).toContainText("Столбцы", { timeout: 240_000 });
    return Date.now() - t0;
  };
  const first = await runFirstExample();
  await page.reload();
  const second = await runFirstExample();
  fs.mkdirSync(path.join(process.cwd(), "reports"), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), "reports", "pyodide-timing.json"), JSON.stringify({ firstLoadMs: first, cachedLoadMs: second, date: new Date().toISOString() }, null, 2));
  console.log(`Pyodide: первая загрузка ${first} мс, повторная ${second} мс`);
  expect(second).toBeLessThan(first);
  await context.close();
});
