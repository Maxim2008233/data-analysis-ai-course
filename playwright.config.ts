import { defineConfig, devices } from "@playwright/test";

// Сквозные тесты сайта. Перед запуском: локальный Supabase (`npx supabase start`) и .env.local.
// Сервер поднимается автоматически: сборка + `next start` на порту 3100.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 240_000,
  expect: { timeout: 45_000 },
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "reports/e2e.json" }], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "ru-RU",
    // service worker (офлайн-режим) отвечает на запросы страницы сам, мимо подмены загрузки Pyodide в helpers.ts:
    // в обычных тестах он выключен, а проверяют его отдельные тесты tests/e2e/pwa.spec.ts (проект pwa)
    serviceWorkers: "block",
  },
  webServer: {
    command: "npm run build && npm run start -- -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: true,
    timeout: 600_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: /pwa\.spec\.ts/ },
    { name: "pwa", use: { ...devices["Desktop Chrome"], serviceWorkers: "allow" }, testMatch: /pwa\.spec\.ts/ },
  ],
});
