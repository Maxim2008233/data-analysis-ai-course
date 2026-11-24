// Клавиши редактора кода — как в IDE (src/components/code/editorKeys.ts).
import { test, expect, getCode, openTask, setCode } from "./helpers";

const TASK = "m1-l1-t1";

test("36. Редактор как в IDE: Tab подставляет подсказку, Enter — новая строка, Tab — отступ в месте курсора, Shift+Tab — назад", async ({ page }) => {
  const card = await openTask(page, TASK);
  const content = card.locator(".cm-content");
  const popup = page.locator(".cm-tooltip-autocomplete");
  const code = () => getCode(page, TASK);

  // подсказка подставляется по Tab
  await setCode(page, TASK, "");
  await content.click();
  await page.keyboard.type("np.aran");
  await expect(popup).toBeVisible();
  await expect(popup).toContainText("arange");
  await page.keyboard.press("Tab");
  await expect.poll(code).toBe("np.arange");
  await expect(popup).toHaveCount(0);

  // Enter при открытом списке подсказок — просто новая строка, подсказка не подставляется
  await page.keyboard.press("Enter");
  await page.keyboard.type("np.aran");
  await expect(popup).toBeVisible();
  await page.keyboard.press("Enter");
  await expect.poll(code).toBe("np.arange\nnp.aran\n");
  await expect(popup).toHaveCount(0);

  // Tab в середине строки — отступ в месте курсора (до следующей позиции табуляции), а не сдвиг всей строки
  await setCode(page, TASK, "x = 1");
  await content.click();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Tab");
  await expect.poll(code).toBe("x    = 1");

  // в начале строки Tab сдвигает код, Shift+Tab убирает отступ
  await setCode(page, TASK, "print(x)");
  await content.click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Tab");
  await expect.poll(code).toBe("    print(x)");
  await page.keyboard.press("Shift+Tab");
  await expect.poll(code).toBe("print(x)");

  // выделено несколько строк — Tab сдвигает их, Shift+Tab возвращает
  await setCode(page, TASK, "a = 1\nb = 2");
  await content.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Tab");
  await expect.poll(code).toBe("    a = 1\n    b = 2");
  await page.keyboard.press("Shift+Tab");
  await expect.poll(code).toBe("a = 1\nb = 2");

  // Tab не уводит фокус из редактора
  await expect(card.locator(".cm-editor.cm-focused")).toHaveCount(1);
});
