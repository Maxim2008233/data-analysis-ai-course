// Кэши офлайн-режима. Названия и ключи — те же, что в public/sw.js (это проверяет tests/unit/pwa.test.ts):
// service worker сохраняет в них то, что открывали, а страница «Приложение» — весь курс целиком.

export const CACHES = {
  /** Страницы: ключ — адрес без ?query. */
  pages: "dsc-pages-v1",
  /** Файлы сборки /_next/static (с хешем в имени). */
  static: "dsc-static-v1",
  /** /data, /py, /workers (одна версия каждого файла), справочник /api/reference, манифест, иконки. */
  files: "dsc-files-v1",
  /** Python (Pyodide), plotly.js, пакеты и метаданные PyPI. */
  cdn: "dsc-cdn-v1",
} as const;

export const CACHE_PREFIX = "dsc-";

/** Ключ страницы в кэше: адрес без query и якоря. */
export function pageKey(path: string, origin: string): string {
  const url = new URL(path, origin);
  return url.origin + url.pathname;
}

/** Удалить все кэши офлайн-режима (кнопка «Удалить офлайн-копию» и выключение PWA). */
export async function clearOfflineCaches(): Promise<void> {
  if (typeof caches === "undefined") return;
  const names = await caches.keys();
  await Promise.all(names.filter((n) => n.startsWith(CACHE_PREFIX)).map((n) => caches.delete(n)));
}
