// Помощники сквозных тестов.
import fs from "node:fs";
import path from "node:path";
import { expect, test as base, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { loadCourse } from "../../src/lib/content/load";

const ROOT = process.cwd();

export function readEnv(): Record<string, string> {
  const file = path.join(ROOT, ".env.local");
  const env: Record<string, string> = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const MIME: Record<string, string> = {
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".zip": "application/zip",
  ".whl": "application/octet-stream",
};

/**
 * Файлы Pyodide отдаём с диска (node_modules/pyodide и кэш пакетов), чтобы тесты не скачивали
 * ~30 МБ в каждом новом контексте браузера. Чего нет локально — загружается из сети как обычно.
 */
export async function routePyodide(context: BrowserContext) {
  await context.route(/cdn\.jsdelivr\.net\/pyodide\/v314\.0\.7\/full\/([^?]+)/, async (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop() ?? "");
    for (const dir of [path.join(ROOT, "node_modules/pyodide"), path.join(ROOT, ".cache/pyodide-packages")]) {
      const p = path.join(dir, name);
      if (name && fs.existsSync(p)) {
        return route.fulfill({
          path: p,
          headers: { "Access-Control-Allow-Origin": "*", "Content-Type": MIME[path.extname(name)] ?? "application/octet-stream" },
        });
      }
    }
    return route.continue();
  });
}

export const test = base.extend({
  context: async ({ context }, provide) => {
    await routePyodide(context);
    await provide(context);
  },
});
export { expect };

/** Новый «чистый» браузер — как другое устройство. */
export async function newDevice(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ locale: "ru-RU" });
  await routePyodide(context);
  return { context, page: await context.newPage() };
}

const course = loadCourse();
export function findTask(taskId: string) {
  for (const m of course.modules)
    for (const l of m.lessons) {
      const t = l.tasks.find((x) => x.id === taskId);
      if (t) return { task: t, href: `/learn/${m.slug}/${l.slug}` };
    }
  throw new Error("нет задания " + taskId);
}
export const TOTAL_TASKS = course.modules.reduce((n, m) => n + m.lessons.reduce((k, l) => k + l.tasks.length, 0), 0);

export async function openTask(page: Page, taskId: string) {
  const { href } = findTask(taskId);
  await page.goto(`${href}#${taskId}`);
  const card = page.locator(`[data-task-id="${taskId}"]`);
  await expect(card).toBeVisible();
  return card;
}

/** Заменить код в редакторе задания. */
export async function setCode(page: Page, taskId: string, code: string) {
  const editor = page.locator(`[data-task-id="${taskId}"] [data-testid="code-editor"]`);
  await expect(editor).toBeVisible();
  await page.evaluate(
    ([id, text]) => {
      const host = document.querySelector(`[data-task-id="${id}"] [data-testid="code-editor"]`) as HTMLElement & {
        __cmView: { state: { doc: { length: number } }; dispatch: (tr: unknown) => void };
      };
      const view = host.__cmView;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    },
    [taskId, code] as const
  );
}

export async function getCode(page: Page, taskId: string): Promise<string> {
  return page.evaluate((id) => {
    const host = document.querySelector(`[data-task-id="${id}"] [data-testid="code-editor"]`) as HTMLElement & {
      __cmView?: { state: { doc: { toString(): string } } };
    };
    return host?.__cmView?.state.doc.toString() ?? "";
  }, taskId);
}

/** Нажать «Проверить» и дождаться результата. */
export async function checkTask(page: Page, taskId: string) {
  const card = page.locator(`[data-task-id="${taskId}"]`);
  const before = await card.locator('[data-testid="check-result"]').count();
  await card.getByTestId("check").click();
  const result = card.getByTestId("check-result");
  if (before) await expect(card.getByTestId("check")).toBeVisible({ timeout: 120_000 });
  await expect(result).toBeVisible({ timeout: 120_000 });
  await expect(card.getByTestId("check")).toBeVisible({ timeout: 120_000 }); // проверка завершилась
  return { passed: (await result.getAttribute("data-passed")) === "true", text: (await result.innerText()).trim() };
}

export async function solveTask(page: Page, taskId: string) {
  const { task } = findTask(taskId);
  await openTask(page, taskId);
  await setCode(page, taskId, task.solution ?? "");
  const r = await checkTask(page, taskId);
  expect(r.passed, r.text).toBe(true);
  await expect(page.locator(`[data-task-id="${taskId}"]`)).toHaveAttribute("data-status", "solved");
}

export function uniqueEmail(tag: string) {
  return `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

/** Уникальный логин для теста: латиница, начинается с буквы. */
export function uniqueLogin(tag: string) {
  return `${tag}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.slice(0, 20);
}

/** Регистрация через форму сайта; возвращает логин нового аккаунта. */
export async function signUp(page: Page, email: string, password: string, login = uniqueLogin("e")) {
  await page.goto("/register");
  await page.locator('input[name="username"]').fill(login);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="password2"]').fill(password);
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();
  await page.waitForURL("**/course");
  return login;
}

/** Вход через форму сайта: по почте или по логину. */
export async function logIn(page: Page, identifier: string, password: string) {
  await page.goto("/login");
  await page.locator('input[name="login"]').fill(identifier);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
}

/** Дождаться, пока все изменения отправлены в облако (нет очереди и статус «Сохранено»). */
export async function waitSynced(page: Page) {
  const s = page.getByTestId("sync-status").first();
  await expect(s).toHaveAttribute("data-pending", "0", { timeout: 30_000 });
  await expect(s).toHaveAttribute("data-status", "idle", { timeout: 30_000 });
}

/** Последнее письмо на адрес из локального почтового ящика Supabase (Mailpit). */
export async function lastEmailTo(email: string): Promise<{ html: string; text: string }> {
  const base = readEnv().MAILPIT_URL || "http://127.0.0.1:54324";
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${base}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const data = (await r.json()) as { messages?: { ID: string }[] };
    if (data.messages?.length) {
      const m = await fetch(`${base}/api/v1/message/${data.messages[0].ID}`);
      const full = (await m.json()) as { HTML: string; Text: string };
      return { html: full.HTML, text: full.Text };
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error("письмо не пришло на " + email);
}
