// Телефон: панель символов кода над экранной клавиатурой. iPhone эмулируется в Chromium (сенсорный экран,
// основной указатель — палец: pointer: coarse); набор текста — клавиатурой Playwright, знаки — кнопками панели.
import { devices, type Browser, type Page } from "@playwright/test";
import { test, expect, checkTask, getCode, openTask, routePyodide, setCode } from "./helpers";

async function iphone(browser: Browser) {
  const { defaultBrowserType, ...options } = devices["iPhone 15"];
  void defaultBrowserType;
  const context = await browser.newContext({ ...options, locale: "ru-RU", serviceWorkers: "block" });
  await routePyodide(context);
  return { context, page: await context.newPage() };
}

const TASK = "m1-l1-t1";

test("34. Телефон: панель символов вставляет скобки, кавычки, двоеточие и отступ, фокус остаётся в редакторе, задание решается; на компьютере панели нет", async ({
  browser,
  page: desktop,
}) => {
  test.setTimeout(240_000);
  const { context, page } = await iphone(browser);
  const card = await openTask(page, TASK);
  const keys = page.getByTestId("code-keys");
  const key = (label: string) => keys.locator(`[data-key="${label}"]`);
  const code = () => getCode(page, TASK);
  const pause = () => page.waitForTimeout(600); // отдельные шаги в истории правок (CodeMirror склеивает правки за 0,5 с)

  await setCode(page, TASK, "");
  await expect(keys).toHaveCount(0);
  await card.locator(".cm-content").tap();
  await expect(keys).toBeVisible();
  await expect(page.getByTestId("open-reference")).toBeHidden(); // кнопка «Справочник» не выглядывает из-под панели

  // distance_col = header.index('Distance') — знаки только с панели
  await page.keyboard.type("distance_col ");
  await key("=").tap();
  await page.keyboard.type(" header.index");
  await key("(").tap(); // пара скобок, курсор внутри
  await key("'").tap(); // пара кавычек
  expect(await code()).toBe("distance_col = header.index('')");
  await page.keyboard.type("Distance");
  await key("'").tap(); // закрывающая кавычка уже стоит — курсор её перескакивает
  await key(")").tap(); // и скобку тоже
  await page.keyboard.press("Enter");
  await page.keyboard.type("print");
  await key("(").tap();
  await page.keyboard.type("distance_col");
  await key(")").tap();
  const solution = "distance_col = header.index('Distance')\nprint(distance_col)";
  expect(await code()).toBe(solution);
  await expect(card.locator(".cm-editor.cm-focused")).toHaveCount(1); // кнопки не забрали фокус

  // отступ, его отмена и история правок
  await pause();
  await key("⇥").tap();
  const indented = "distance_col = header.index('Distance')\n    print(distance_col)";
  expect(await code()).toBe(indented);
  await pause();
  await key("⇤").tap();
  expect(await code()).toBe(solution);
  await pause();
  await key("↶").tap();
  expect(await code()).toBe(indented);
  await key("↷").tap();
  expect(await code()).toBe(solution);

  // стрелки двигают курсор
  await page.keyboard.press("End");
  await key("←").tap();
  await key("←").tap();
  await page.keyboard.type("X");
  expect(await code()).toBe("distance_col = header.index('Distance')\nprint(distance_coXl)");
  await key("→").tap();
  await key("↑").tap();
  await key("↶").tap(); // убрать «X»
  expect(await code()).toBe(solution);

  // панель не расширяет страницу; скриншот — для отчёта
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const box = await keys.boundingBox();
  const vh = page.viewportSize()!.height;
  expect(box && Math.round(box.y + box.height)).toBeLessThanOrEqual(vh); // у нижнего края видимой части
  await page.screenshot({ path: "reports/screenshots/34-code-keys-iphone.png" });

  // решение, набранное с панелью, проходит проверку; после ухода из редактора панель скрывается
  const r = await checkTask(page, TASK);
  expect(r.passed, r.text).toBe(true);
  await expect(keys).toHaveCount(0);
  await expect(page.getByTestId("open-reference")).toBeVisible();
  await context.close();

  // компьютер: панели нет
  await checkNoKeysOnDesktop(desktop);
});

async function checkNoKeysOnDesktop(page: Page) {
  const card = await openTask(page, TASK);
  await card.locator(".cm-content").click();
  await expect(card.locator(".cm-editor.cm-focused")).toHaveCount(1);
  await page.waitForTimeout(300);
  await expect(page.getByTestId("code-keys")).toHaveCount(0);
}

test("35. Цвет строки состояния телефона и панели браузера (theme-color) — по теме, выбранной на сайте, и после переходов", async ({ page }) => {
  const colors = () => page.evaluate(() => [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute("content")));
  const LIGHT = ["#f4efe4", "#f4efe4"];
  const DARK = ["#0f1726", "#0f1726"];
  await page.goto("/course");
  await expect.poll(colors).toEqual(LIGHT); // системная тема светлая, на сайте тоже
  await page.getByRole("button", { name: "Включить тёмную тему" }).first().click();
  await expect.poll(colors).toEqual(DARK); // тёмная включена кнопкой — строка состояния тёмная, хотя система светлая
  await page.getByRole("link", { name: "Задачи" }).first().click(); // переход внутри сайта без перезагрузки
  await page.waitForURL("**/tasks");
  await expect.poll(colors).toEqual(DARK);
  await page.reload(); // тема запомнена
  await expect.poll(colors).toEqual(DARK);
  await page.getByRole("button", { name: "Включить светлую тему" }).first().click();
  await expect.poll(colors).toEqual(LIGHT);
});
