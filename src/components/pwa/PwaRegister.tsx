"use client";
// Регистрация service worker'а (офлайн-режим, public/sw.js) и событий установки приложения.
// Работает только в сборке для продакшена. В режиме разработки и при NEXT_PUBLIC_PWA=off (аварийное выключение,
// см. DEPLOY.md) уже установленный service worker удаляется вместе с кэшами.
import { useEffect } from "react";
import { APP_VERSION, PWA_ENABLED } from "@/lib/config";
import { clearOfflineCaches } from "@/lib/pwa/caches";
import { initInstallEvents } from "@/lib/pwa/client";

/** Для какой версии сайта сохранена страница «Нет подключения» (её файлы сборки меняются с версией). */
const LS_OFFLINE_PAGE = "dsc.pwa.offlinePage";

async function removeServiceWorker() {
  const regs = await navigator.serviceWorker.getRegistrations();
  if (!regs.length) return;
  await Promise.all(regs.map((r) => r.unregister()));
  await clearOfflineCaches();
}

async function registerServiceWorker() {
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem(LS_OFFLINE_PAGE);
  } catch {
    /* хранилище недоступно */
  }
  if (saved === APP_VERSION) return;
  // вышла новая версия сайта: обновить сохранённую страницу «Нет подключения»
  const sw = reg.active ?? (await navigator.serviceWorker.ready).active;
  sw?.postMessage({ type: "refresh-offline-page" });
  try {
    window.localStorage.setItem(LS_OFFLINE_PAGE, APP_VERSION);
  } catch {
    /* хранилище недоступно */
  }
}

export function PwaRegister() {
  useEffect(() => {
    initInstallEvents();
    if (!("serviceWorker" in navigator)) return;
    if (!PWA_ENABLED || process.env.NODE_ENV !== "production") {
      removeServiceWorker().catch(() => {});
      return;
    }
    // офлайн-режим необязателен: если регистрация не удалась, сайт работает как обычно
    const start = () => registerServiceWorker().catch(() => {});
    if (document.readyState === "complete") start();
    else {
      window.addEventListener("load", start, { once: true });
      return () => window.removeEventListener("load", start);
    }
  }, []);
  return null;
}
