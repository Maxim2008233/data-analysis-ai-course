// Безопасный разбор адресов, которые приходят снаружи (параметры и хэш ссылки).

const PLACEHOLDER = "https://site.invalid";

/**
 * Куда вести после входа. Принимается только путь этого же сайта («/profile», «/learn/…?x=1#y»),
 * иначе — fallback. Адрес разбирается так же, как его разобрал бы браузер: «https://…», «//…»,
 * «/\…», «/<Tab>/…» и «javascript:…» ведут на другой сайт или схему и отбрасываются.
 */
export function safeNext(raw: string | null | undefined, fallback = "/course"): string {
  if (!raw || !raw.startsWith("/")) return fallback;
  let url: URL;
  try {
    url = new URL(raw, PLACEHOLDER);
  } catch {
    return fallback;
  }
  if (url.origin !== PLACEHOLDER) return fallback;
  return url.pathname + url.search + url.hash;
}

/** Хэш адреса без «#», раскодированный. Испорченная кодировка (например «#%E0%A4%A») не роняет страницу. */
export function decodeHash(hash: string): string {
  const raw = hash.replace(/^#/, "");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
