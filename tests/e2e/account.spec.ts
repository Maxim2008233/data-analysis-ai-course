// Сценарии с аккаунтом (локальный Supabase): 2 (перенос прогресса гостя), 3 (вход на «новом устройстве»),
// 4 (изменения видны на другом устройстве), 7 (смена пароля), 8 (восстановление пароля), 9 (удаление аккаунта),
// 12 (обрыв сети при сохранении), 29 (логин: в углу экрана, вход по логину, аккаунт без логина).
// Сценарий 11 (RLS) проверяется напрямую через API в tests/integration/db.test.ts.
import { test, expect, newDevice, solveTask, openTask, getCode, findTask, uniqueEmail, uniqueLogin, signUp, logIn, waitSynced, lastEmailTo, readEnv, setCode, checkTask, TOTAL_TASKS } from "./helpers";

const PASSWORD = "Password-123";

test("2–4. Регистрация переносит прогресс гостя; вход на другом устройстве; синхронизация между устройствами", async ({ page, browser }) => {
  // гость решает задание
  await solveTask(page, "m1-l0-t2");
  const email = uniqueEmail("sync");
  const login = await signUp(page, email, PASSWORD);
  await expect(page.getByTestId("auth-notice")).toContainText("Перенесено 1");
  // в углу экрана — логин, а не почта
  await expect(page.getByTestId("profile-link").first()).toHaveText(login);
  await waitSynced(page);
  await page.goto("/profile");
  await expect(page.getByTestId("stat-solved")).toHaveText(`1 / ${TOTAL_TASKS}`);

  // устройство Б: новый браузер, вход — прогресс и код на месте
  const b = await newDevice(browser);
  await logIn(b.page, email, PASSWORD);
  await b.page.waitForURL("**/course");
  await openTask(b.page, "m1-l0-t2");
  await expect(b.page.locator('[data-task-id="m1-l0-t2"]')).toHaveAttribute("data-status", "solved");
  await expect.poll(() => getCode(b.page, "m1-l0-t2")).toBe(findTask("m1-l0-t2").task.solution);

  // на устройстве Б решаем ещё одно задание — на устройстве А оно видно после открытия страницы
  await solveTask(b.page, "m1-l0-t3");
  await waitSynced(b.page);
  await openTask(page, "m1-l0-t3");
  await expect(page.locator('[data-task-id="m1-l0-t3"]')).toHaveAttribute("data-status", "solved", { timeout: 30_000 });

  // выход на А и вход в совсем новом контексте — всё на месте
  await page.goto("/profile");
  await page.getByTestId("logout").click();
  await expect(page.getByTestId("login-link").first()).toBeVisible();
  // на третьем устройстве — вход по логину вместо почты
  const c = await newDevice(browser);
  await logIn(c.page, login, PASSWORD);
  await c.page.waitForURL("**/course");
  await c.page.goto("/profile");
  await expect(c.page.getByTestId("stat-solved")).toHaveText(`2 / ${TOTAL_TASKS}`);
  await b.context.close();
  await c.context.close();
});

test("7. Смена пароля: старый пароль больше не подходит, новый подходит", async ({ page, browser }) => {
  const email = uniqueEmail("pwd");
  await signUp(page, email, PASSWORD);
  await page.goto("/profile");
  const form = page.getByTestId("change-password-form");
  await form.locator('input[name="current"]').fill("wrong-password");
  await form.locator('input[name="new"]').fill("NewPassword-456");
  await form.locator('input[name="new2"]').fill("NewPassword-456");
  await form.getByRole("button", { name: "Сменить пароль" }).click();
  await expect(page.getByTestId("password-error")).toContainText("Текущий пароль указан неверно");
  await form.locator('input[name="current"]').fill(PASSWORD);
  await form.getByRole("button", { name: "Сменить пароль" }).click();
  await expect(page.getByTestId("password-ok")).toBeVisible();

  const d = await newDevice(browser);
  await logIn(d.page, email, PASSWORD);
  await expect(d.page.getByTestId("auth-error")).toContainText("Неверный email или пароль");
  await logIn(d.page, email, "NewPassword-456");
  await d.page.waitForURL("**/course");
  await d.context.close();
});

test("8. Восстановление пароля по письму (локальный почтовый ящик Supabase)", async ({ page }) => {
  const email = uniqueEmail("reset");
  await signUp(page, email, PASSWORD);
  await page.goto("/profile");
  await page.getByTestId("logout").click();
  await expect(page.getByTestId("login-link").first()).toBeVisible();

  await page.goto("/forgot-password");
  await page.locator('input[name="email"]').fill(email);
  await page.getByRole("button", { name: "Отправить ссылку" }).click();
  await expect(page.getByTestId("auth-ok")).toContainText("письмо со ссылкой");

  const mail = await lastEmailTo(email);
  const link = /(https?:\/\/[^\s"'<>]+verify[^\s"'<>]+)/.exec(mail.text || mail.html)?.[1]?.replace(/&amp;/g, "&");
  expect(link, "ссылка в письме").toBeTruthy();
  await page.goto(link!);
  await page.waitForURL("**/reset-password**");
  const form = page.getByTestId("reset-form");
  await expect(form).toBeVisible();
  await form.locator('input[name="password"]').fill("Recovered-789");
  await form.locator('input[name="password2"]').fill("Recovered-789");
  await form.getByRole("button", { name: "Сохранить пароль" }).click();
  await page.waitForURL("**/profile?password=changed");
  await page.getByTestId("logout").click();
  await expect(page.getByTestId("login-link").first()).toBeVisible();
  await logIn(page, email, "Recovered-789");
  await page.waitForURL("**/course");
});

test("9. Удаление аккаунта стирает облачные данные, вход становится невозможен", async ({ page }) => {
  const email = uniqueEmail("del");
  await signUp(page, email, PASSWORD);
  await solveTask(page, "m1-l0-t1");
  await waitSynced(page);
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem("dsc-auth") || "{}")?.user?.id as string);
  expect(userId).toBeTruthy();
  const env = readEnv();
  const rest = (q: string) =>
    fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${q}`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } }).then((r) => r.json());
  expect((await rest(`progress?user_id=eq.${userId}`)).length).toBeGreaterThan(0);

  await page.goto("/profile");
  await page.getByTestId("delete-account").click();
  await page.getByTestId("delete-confirm-input").fill("УДАЛИТЬ");
  await page.getByTestId("delete-confirm").click();
  await page.waitForURL("**/?deleted=1");
  expect(await rest(`progress?user_id=eq.${userId}`)).toEqual([]);
  expect(await rest(`profiles?user_id=eq.${userId}`)).toEqual([]);
  await logIn(page, email, PASSWORD);
  await expect(page.getByTestId("auth-error")).toContainText("Неверный email или пароль");
});

test("12. Обрыв сети при сохранении: изменения копятся и отправляются после восстановления связи", async ({ page, context, browser }) => {
  const email = uniqueEmail("offline");
  await signUp(page, email, PASSWORD);
  // Python загружаем заранее — без сети он продолжит работать
  const card = await openTask(page, "m1-l0-t1");
  await card.getByTestId("run").click();
  await expect(card.getByTestId("run-output").or(card.getByTestId("run-note"))).toBeVisible({ timeout: 120_000 });

  await context.setOffline(true);
  await setCode(page, "m1-l0-t1", findTask("m1-l0-t1").task.solution ?? "");
  const r = await checkTask(page, "m1-l0-t1");
  expect(r.passed, r.text).toBe(true);
  await expect(page.getByTestId("sync-status").first()).toHaveAttribute("data-status", /offline|error/, { timeout: 30_000 });

  await context.setOffline(false);
  await waitSynced(page);
  const d = await newDevice(browser);
  await logIn(d.page, email, PASSWORD);
  await d.page.waitForURL("**/course");
  await openTask(d.page, "m1-l0-t1");
  await expect(d.page.locator('[data-task-id="m1-l0-t1"]')).toHaveAttribute("data-status", "solved");
  await d.context.close();
});

test("29. Логин: в углу экрана вместо почты, вход по логину, аккаунт без логина задаёт его в профиле", async ({ page }) => {
  // аккаунт без логина — как созданные до появления логинов: регистрация напрямую через Supabase без поля username
  const env = readEnv();
  const email = uniqueEmail("old");
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(r.ok).toBe(true);

  await logIn(page, email, PASSWORD);
  await page.waitForURL("**/course");
  const corner = page.getByTestId("profile-link").first();
  await expect(corner).toHaveText("Придумайте логин");
  await expect(page.locator("body")).not.toContainText(email);

  // неверный логин — понятное сообщение; занятый логин не взять
  await corner.click();
  await page.waitForURL("**/profile#login");
  await expect(page.getByTestId("username-needed")).toBeVisible();
  const form = page.getByTestId("username-form");
  await form.locator('input[name="username"]').fill("1bad");
  await form.getByTestId("username-save").click();
  await expect(page.getByTestId("username-msg")).toContainText("начинаться с латинской буквы");

  const login = uniqueLogin("old");
  await form.locator('input[name="username"]').fill(login);
  await form.getByTestId("username-save").click();
  await expect(page.getByTestId("username-msg")).toContainText("Логин сохранён");
  await expect(page.getByTestId("profile-link").first()).toHaveText(login);

  // выход и вход по логину; неверный пароль по логину — общее сообщение
  await page.getByTestId("logout").click();
  await expect(page.getByTestId("login-link").first()).toBeVisible();
  await logIn(page, login, "wrong-password");
  await expect(page.getByTestId("auth-error")).toContainText("Неверный логин или пароль");
  await logIn(page, login.toUpperCase(), PASSWORD);
  await page.waitForURL("**/course");
  await expect(page.getByTestId("profile-link").first()).toHaveText(login);
});
