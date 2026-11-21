// Установка как приложения (PWA) и офлайн-режим. Здесь service worker включён (проект pwa в playwright.config.ts):
// его запросы к jsDelivr Playwright тоже отдаёт с диска (routePyodide), а «без интернета» — это
// context.setOffline(true) плюс обрыв всех сетевых запросов: открыться может только то, что лежит в кэше.
import { devices, type BrowserContext, type Page } from "@playwright/test";
import { test, expect, checkTask, findTask, setCode, solveTask } from "./helpers";

async function waitControlled(page: Page) {
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 60_000 });
}

async function goOffline(context: BrowserContext) {
  await context.route("**/*", (route) => route.abort("internetdisconnected"));
  await context.setOffline(true);
}

function cachedUrls(page: Page, cacheName: string): Promise<string[]> {
  return page.evaluate(async (name) => (await (await caches.open(name)).keys()).map((r) => r.url), cacheName);
}

/** Настройки устройства из каталога Playwright, но в Chromium (defaultBrowserType — не настройка контекста). */
function device(name: string) {
  const { defaultBrowserType, ...options } = devices[name];
  void defaultBrowserType;
  return { ...options, locale: "ru-RU", serviceWorkers: "block" as const };
}

/** Размеры PNG из заголовка IHDR. */
function pngSize(buf: Buffer): [number, number] {
  expect(buf.subarray(1, 4).toString("latin1")).toBe("PNG");
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

test("30. Манифест, иконки и теги для iPhone; service worker без долгого кэша", async ({ request }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ display: "standalone", start_url: "/course", scope: "/", lang: "ru", short_name: "Лаб. данных" });
  // без theme_color нижняя панель Android следует теме телефона (с ним в тёмной теме она была светлой)
  expect(manifest.theme_color).toBeUndefined();
  const purposes = new Set<string>();
  for (const icon of manifest.icons as { src: string; sizes: string; purpose: string }[]) {
    const res = await request.get(icon.src);
    expect(res.status(), icon.src).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
    expect(pngSize(await res.body()).join("x")).toBe(icon.sizes);
    purposes.add(`${icon.purpose} ${icon.sizes}`);
  }
  for (const need of ["any 192x192", "any 512x512", "maskable 512x512"]) expect(purposes).toContain(need);

  const html = await (await request.get("/course")).text();
  expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"');
  expect(html).toMatch(/<link rel="apple-touch-icon" href="\/apple-icon\.png[^"]*" sizes="180x180"/);
  expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes"');
  expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Лаб. данных"');
  const apple = await request.get("/apple-icon.png");
  expect(pngSize(await apple.body())).toEqual([180, 180]);

  const sw = await request.get("/sw.js");
  expect(sw.status()).toBe(200);
  expect(sw.headers()["content-type"]).toContain("javascript");
  expect(sw.headers()["cache-control"]).toContain("no-cache");
});

test("31. Открытый урок работает без интернета вместе с Python; неоткрытый — страница «Нет подключения»", async ({ page, context }) => {
  test.setTimeout(420_000);
  const { task, href } = findTask("m1-l1-t1");
  await page.goto(href);
  await waitControlled(page);
  // Chrome считает сайт устанавливаемым (те же критерии, по которым Android предлагает «Установить приложение»)
  const cdp = await context.newCDPSession(page);
  const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
  expect(installabilityErrors, JSON.stringify(installabilityErrors)).toEqual([]);
  const { errors: manifestErrors } = await cdp.send("Page.getAppManifest");
  expect(manifestErrors).toEqual([]);
  await cdp.detach(); // открытый сеанс DevTools мешает эмуляции «нет сети» дальше в тесте
  // страница уже под service worker'ом: открываем заново, чтобы она и её файлы попали в кэш
  await page.reload();
  await solveTask(page, "m1-l1-t1");
  await expect
    .poll(async () => (await cachedUrls(page, "dsc-cdn-v1")).some((u) => u.endsWith("/pyodide.asm.wasm")), { timeout: 60_000 })
    .toBe(true);
  await expect.poll(async () => (await cachedUrls(page, "dsc-pages-v1")).some((u) => u.endsWith(href)), { timeout: 30_000 }).toBe(true);

  await goOffline(context);
  await page.reload();
  await expect(page.getByTestId("offline-banner")).toBeVisible();
  await expect(page.locator('[data-task-id="m1-l1-t1"]')).toBeVisible();
  // Python из кэша: снова проверяем решение
  await setCode(page, "m1-l1-t1", task.solution ?? "");
  const r = await checkTask(page, "m1-l1-t1");
  expect(r.passed, r.text).toBe(true);

  // урок, который не открывали: страница «Нет подключения» со списком сохранённых
  const other = findTask("m1-l2-t1").href;
  await page.goto(other);
  await expect(page).toHaveURL(/\/offline\?from=/);
  await expect(page.getByTestId("offline-page")).toBeVisible();
  await expect(page.getByTestId("offline-retry")).toHaveAttribute("href", other);
  const saved = page.getByTestId("offline-lesson");
  await expect(saved).toHaveCount(1);
  await saved.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  // урок открылся из кэша на первом шаге (задание — на одном из следующих шагов)
  await expect(page.getByRole("heading", { level: 1 })).toContainText("От вопроса к таблице");
  await expect(page.locator('[data-task-id="m1-l1-t1"]')).toHaveCount(1);
  await expect(page.getByTestId("offline-banner")).toBeVisible();
});

test("32. «Скачать курс»: весь курс без интернета — урок с seaborn, урок с plotly, справочник", async ({ page, context }) => {
  test.setTimeout(900_000);
  await page.goto("/app");
  await waitControlled(page);
  await page.reload();
  await expect(page.getByTestId("offline-status")).toContainText("ещё не скачан");
  await page.getByTestId("offline-download").click();
  await expect(page.getByTestId("offline-progress")).toBeVisible();
  const result = page.getByTestId("offline-result");
  await expect(result).toBeVisible({ timeout: 840_000 });
  await expect(result, await result.innerText()).toHaveAttribute("data-ok", "true");
  await expect(page.getByTestId("offline-status")).toContainText("Курс скачан целиком");
  await expect(page.getByTestId("offline-status")).toContainText("Сохранено страниц: 189 из 189");
  // в кэше — все страницы, ядро Python, пакеты курса и seaborn с plotly (их ставит micropip с PyPI)
  expect((await cachedUrls(page, "dsc-pages-v1")).length).toBe(189);
  const cdn = await cachedUrls(page, "dsc-cdn-v1");
  const files = cdn.map((u) => u.split("/").pop()!);
  for (const name of ["pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json", "plotly.min.js"]) expect(files).toContain(name);
  for (const name of ["numpy-", "pandas-", "matplotlib-", "scikit_learn-", "scipy-", "lightgbm-", "jinja2-", "micropip-", "narwhals-"]) {
    expect(files.some((f) => f.startsWith(name)), name).toBe(true);
  }
  for (const name of ["seaborn-", "plotly-"]) expect(cdn.some((u) => u.includes("files.pythonhosted.org") && u.split("/").pop()!.startsWith(name))).toBe(true);
  // сколько места занял курс (для оценки на странице «Без интернета» и в README)
  const usage = await page.evaluate(async () => (await navigator.storage.estimate()).usage ?? 0);
  test.info().annotations.push({ type: "storage", description: `${Math.round(usage / 2 ** 20)} МБ` });
  console.log(`[pwa] курс на устройстве: ${Math.round(usage / 2 ** 20)} МБ`);

  await goOffline(context);
  // уроки, которые в этом браузере ни разу не открывались и Python для которых не запускался
  await solveTask(page, "m4-l6-t1"); // seaborn
  await solveTask(page, "m4-l10-t1"); // plotly
  await solveTask(page, "m5-l4-t1"); // scikit-learn
  await expect(page.getByTestId("offline-banner")).toBeVisible();
  await page.getByTestId("open-reference").click();
  await expect(page.getByTestId("reference-results").locator("li").first()).toBeVisible();
});

test("33. Подсказка установки: iPhone — «Поделиться → На экран „Домой“», Android — кнопка «Установить»", async ({ browser }) => {
  const iphone = await browser.newContext(device("iPhone 15"));
  const ip = await iphone.newPage();
  await ip.goto("/course");
  const hint = ip.getByTestId("install-hint");
  await expect(hint).toBeVisible();
  await expect(hint).toHaveAttribute("data-os", "ios");
  await expect(hint).toContainText("На экран „Домой“");
  await ip.getByTestId("install-hint-dismiss").click();
  await expect(hint).toHaveCount(0);
  await ip.reload();
  await expect(ip.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(ip.getByTestId("install-hint")).toHaveCount(0);
  await ip.goto("/app");
  await expect(ip.getByTestId("install-ios")).toContainText("На экран „Домой“");
  await expect(ip.getByTestId("account-card")).toContainText("отдельно от Safari");
  await iphone.close();

  const android = await browser.newContext(device("Pixel 7"));
  const an = await android.newPage();
  await an.goto("/app");
  await expect(an.getByTestId("install-android")).toBeVisible();
  // браузер разрешает установку: событие beforeinstallprompt (здесь — его имитация)
  await an.evaluate(() => {
    const e = new Event("beforeinstallprompt", { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
    e.prompt = async () => {
      (window as unknown as { __prompted: boolean }).__prompted = true;
    };
    e.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(e);
  });
  await an.getByTestId("install-button").click();
  await expect(an.getByTestId("install-card")).toContainText("Приложение установлено");
  expect(await an.evaluate(() => (window as unknown as { __prompted?: boolean }).__prompted)).toBe(true);
  // после перезагрузки (событие установки уже использовано) — подсказка со ссылкой на инструкцию
  await an.goto("/course");
  await expect(an.getByTestId("install-hint")).toHaveAttribute("data-os", "android");
  await expect(an.getByTestId("install-hint-more")).toBeVisible();
  await android.close();
});
