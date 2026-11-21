"use client";
import { useEffect, useSyncExternalStore } from "react";
import { THEME_COLOR_DARK, THEME_COLOR_LIGHT } from "@/lib/config";

export const THEME_KEY = "dsc-theme";

/** Скрипт в <head>: ставит тему до отрисовки, чтобы не было вспышки. */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

function subscribeTheme(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}
const isDark = () => document.documentElement.classList.contains("dark");

/**
 * Цвет строки состояния телефона и панели браузера (<meta name="theme-color">) — по теме сайта, а не только системной:
 * если тёмную тему включили кнопкой при светлой теме телефона (или наоборот), полоса сверху совпадает со страницей.
 * Next.js выводит два тега с media по системной теме; здесь обоим ставится цвет текущей темы — и при переключении,
 * и когда при переходах между страницами теги в <head> перерисовываются.
 */
export function ThemeColorSync() {
  useEffect(() => {
    const apply = () => {
      const color = isDark() ? THEME_COLOR_DARK : THEME_COLOR_LIGHT;
      document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
        if (m.getAttribute("content") !== color) m.setAttribute("content", color);
      });
    };
    apply();
    const obs = new MutationObserver(apply);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    obs.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ["content"] });
    return () => obs.disconnect();
  }, []);
  return null;
}

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribeTheme, isDark, () => false);
  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {
      /* ignore */
    }
  }
  return (
    <button
      type="button"
      onClick={toggle}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink hover:bg-soft"
      aria-label={dark ? "Включить светлую тему" : "Включить тёмную тему"}
      title={dark ? "Светлая тема" : "Тёмная тема"}
    >
      {dark ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}
