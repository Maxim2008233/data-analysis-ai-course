"use client";
// «Скачать курс для офлайна»: страницы, файлы сборки, данные, Python и его библиотеки — в кэши service worker'а
// (те же кэши и ключи, что в public/sw.js, см. caches.ts). Список файлов курса собирается при сборке сайта
// (src/app/offline-files.json/route.ts). Скачивает страница «Приложение», пока она открыта; уже сохранённое
// не скачивается заново, поэтому прерванную загрузку можно продолжить.
import { APP_VERSION, PLOTLY_SRC, PY_MICROPIP_MODULES, PYODIDE_CORE_FILES, PYODIDE_INDEX_URL } from "../config";
import { CACHES, pageKey } from "./caches";
import { resolvePyodidePackages, type PyodideLock } from "./pyodide-lock";

/** Список файлов курса для офлайна (строит src/lib/pwa/offline-manifest.ts при сборке). */
export interface OfflineManifest {
  version: string;
  /** Адреса страниц: оглавление, модули, уроки, служебные страницы. */
  pages: string[];
  /** Файлы сборки /_next/static/… */
  static: string[];
  /** /data/…, /py/…, /workers/… — запрашиваются с ?v=<версия сайта>. */
  files: string[];
  /** Справочник, манифест, иконки: небольшие файлы без версии в адресе. */
  fresh: string[];
  /** Модули Python, которые импортирует код курса. */
  imports: string[];
  /** Примерный объём на устройстве, байт. */
  approxBytes: number;
}

export interface OfflineProgress {
  phase: "prepare" | "files" | "python" | "finish";
  done: number;
  total: number;
  /** Сколько байт скачано (по заголовкам ответов; без учёта уже сохранённого). */
  bytes: number;
  failed: number;
}

export interface OfflineResult {
  ok: boolean;
  failed: number;
  pages: number;
  /** Браузер обещал не удалять сохранённое при нехватке места (navigator.storage.persist). */
  persisted: boolean | null;
  /** Сообщение для ученика, если что-то не получилось. */
  message: string | null;
}

/** Отметка о скачанном курсе (в localStorage: браузеру не нужен интернет, чтобы её прочитать). */
export interface OfflineRecord {
  version: string;
  at: number;
  pages: number;
  complete: boolean;
}

const LS_KEY = "dsc.pwa.offline";
const CONCURRENCY = 4;
const PREFETCH_TIMEOUT_MS = 5 * 60_000;

export function readOfflineRecord(): OfflineRecord | null {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as Partial<OfflineRecord>;
    if (typeof r.version !== "string" || typeof r.at !== "number") return null;
    return { version: r.version, at: r.at, pages: Number(r.pages ?? 0), complete: Boolean(r.complete) };
  } catch {
    return null;
  }
}

function writeOfflineRecord(r: OfflineRecord | null) {
  try {
    if (r) window.localStorage.setItem(LS_KEY, JSON.stringify(r));
    else window.localStorage.removeItem(LS_KEY);
  } catch {
    /* хранилище недоступно — отметка не сохранится, файлы останутся */
  }
}

export function forgetOfflineRecord() {
  writeOfflineRecord(null);
}

/** Поддерживает ли браузер офлайн-режим. */
export function offlineSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && typeof caches !== "undefined";
}

/** Адреса сохранённых страниц (без query). */
export async function listSavedPages(): Promise<string[]> {
  if (typeof caches === "undefined") return [];
  try {
    const cache = await caches.open(CACHES.pages);
    return (await cache.keys()).map((r) => new URL(r.url).pathname);
  } catch {
    return [];
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    if (!e || typeof e.usage !== "number" || typeof e.quota !== "number") return null;
    return { usage: e.usage, quota: e.quota };
  } catch {
    return null;
  }
}

export async function fetchOfflineManifest(): Promise<OfflineManifest> {
  const r = await fetch("/offline-files.json", { cache: "no-cache" });
  if (!r.ok) throw new Error(`Не удалось получить список файлов курса (HTTP ${r.status}).`);
  return (await r.json()) as OfflineManifest;
}

type Kind = "page" | "static" | "versioned" | "fresh" | "cdn";
interface Job {
  url: string; // что запрашивать
  key: string; // ключ в кэше
  cache: string;
  kind: Kind;
}

class QuotaError extends Error {}

function isQuota(e: unknown): boolean {
  const name = (e as { name?: string })?.name ?? "";
  return name === "QuotaExceededError" || /quota/i.test(String((e as Error)?.message ?? ""));
}

/** Дождаться, пока страницей управляет service worker (без него Python и PyPI не попадут в кэш). */
async function waitForController(ms: number): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  if (navigator.serviceWorker.controller) return true;
  await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, ms))]);
  if (navigator.serviceWorker.controller) return true;
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true }
    );
  });
  return Boolean(navigator.serviceWorker.controller);
}

/**
 * Загрузить библиотеки, которые ставятся через micropip (seaborn, plotly), в отдельном Python: его запросы
 * к PyPI идут через service worker и попадают в кэш. После загрузки этот Python закрывается.
 */
function prefetchMicropip(modules: string[], signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const w = new Worker(`/workers/py-worker.mjs?v=${encodeURIComponent(APP_VERSION)}`, { type: "module" });
    const done = (err?: Error) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      w.terminate();
      if (err) reject(err);
      else resolve();
    };
    const onAbort = () => done(new DOMException("Загрузка отменена", "AbortError"));
    const timer = setTimeout(() => done(new Error("Библиотеки Python загружались слишком долго.")), PREFETCH_TIMEOUT_MS);
    signal.addEventListener("abort", onAbort);
    w.onerror = (ev) => {
      ev.preventDefault?.();
      done(new Error("Не удалось запустить Python для загрузки библиотек."));
    };
    w.onmessage = (ev: MessageEvent) => {
      const msg = (ev.data ?? {}) as { id?: number; type?: string; message?: string };
      if (msg.id !== 1) return;
      if (msg.type === "result") done();
      else if (msg.type === "error") done(new Error(msg.message || "Ошибка загрузки библиотек Python."));
    };
    w.postMessage({ id: 1, type: "prefetch", code: modules.map((m) => `import ${m}`).join("\n") });
  });
}

/** Сохранены ли колёса micropip-пакетов (их адреса знает только micropip, поэтому проверяем по именам файлов). */
async function micropipCached(modules: string[]): Promise<string[]> {
  const cache = await caches.open(CACHES.cdn);
  const files = (await cache.keys()).map((r) => r.url).filter((u) => u.startsWith("https://files.pythonhosted.org/"));
  return modules.filter((m) => !files.some((u) => u.split("/").pop()?.toLowerCase().startsWith(m.toLowerCase() + "-")));
}

/**
 * Скачать курс целиком. onProgress вызывается после каждого файла. Отмена — через signal.
 * Уже сохранённые неизменяемые файлы (сборка, Python, данные этой версии) не скачиваются заново;
 * страницы скачиваются заново, если сохранены для другой версии сайта.
 */
export async function downloadCourse(manifest: OfflineManifest, onProgress: (p: OfflineProgress) => void, signal: AbortSignal): Promise<OfflineResult> {
  const origin = window.location.origin;
  const progress: OfflineProgress = { phase: "prepare", done: 0, total: 0, bytes: 0, failed: 0 };
  const report = () => onProgress({ ...progress });
  report();

  let persisted: boolean | null = null;
  try {
    persisted = (await navigator.storage?.persist?.()) ?? null;
  } catch {
    persisted = null;
  }
  const controlled = await waitForController(10_000);

  // Python: файлы Pyodide, пакеты курса (по pyodide-lock.json) и их зависимости
  const lockUrl = PYODIDE_INDEX_URL + "pyodide-lock.json";
  const lockRes = await fetch(lockUrl, { mode: "cors", credentials: "omit", signal });
  if (!lockRes.ok) throw new Error(`Не удалось получить список пакетов Python (HTTP ${lockRes.status}).`);
  const lock = (await lockRes.clone().json()) as PyodideLock;
  await (await caches.open(CACHES.cdn)).put(lockUrl, lockRes);
  const micropip = PY_MICROPIP_MODULES.filter((m) => manifest.imports.includes(m));
  // jinja2 — для таблиц pandas со стилями (df.style), micropip — для seaborn и plotly
  const packageFiles = resolvePyodidePackages(lock, [...manifest.imports, "jinja2", ...(micropip.length ? ["micropip"] : [])]);

  const record = readOfflineRecord();
  const sameVersion = record?.version === manifest.version;
  const v = encodeURIComponent(APP_VERSION);
  const jobs: Job[] = [
    ...manifest.pages.map((p) => ({ url: p, key: pageKey(p, origin), cache: CACHES.pages, kind: "page" as const })),
    ...manifest.static.map((p) => ({ url: p, key: origin + p, cache: CACHES.static, kind: "static" as const })),
    ...manifest.files.map((p) => ({ url: `${p}?v=${v}`, key: `${origin}${p}?v=${v}`, cache: CACHES.files, kind: "versioned" as const })),
    ...manifest.fresh.map((p) => ({ url: p, key: origin + p, cache: CACHES.files, kind: "fresh" as const })),
    ...[...PYODIDE_CORE_FILES.filter((f) => f !== "pyodide-lock.json"), ...packageFiles].map((f) => ({
      url: PYODIDE_INDEX_URL + f,
      key: PYODIDE_INDEX_URL + f,
      cache: CACHES.cdn,
      kind: "cdn" as const,
    })),
    { url: PLOTLY_SRC, key: PLOTLY_SRC, cache: CACHES.cdn, kind: "cdn" as const },
  ];
  progress.phase = "files";
  progress.total = jobs.length + (micropip.length ? 1 : 0);
  report();

  const opened = new Map<string, Promise<Cache>>();
  const open = (name: string) => {
    if (!opened.has(name)) opened.set(name, caches.open(name));
    return opened.get(name)!;
  };

  async function runJob(job: Job) {
    const cache = await open(job.cache);
    // неизменяемое не скачиваем заново; страницы — если уже сохранены для этой версии сайта (продолжение загрузки)
    if (job.kind === "static" || job.kind === "cdn" || job.kind === "versioned" || (job.kind === "page" && sameVersion)) {
      if (await cache.match(job.key, { ignoreVary: true })) return;
    }
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal.aborted) throw new DOMException("Загрузка отменена", "AbortError");
      try {
        const res = await fetch(job.url, {
          signal,
          cache: job.kind === "page" || job.kind === "fresh" ? "no-cache" : "default",
          ...(job.kind === "cdn" ? { mode: "cors" as const, credentials: "omit" as const } : { credentials: "same-origin" as const }),
        });
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
        if (job.kind === "page" && !(res.headers.get("Content-Type") ?? "").startsWith("text/html")) throw new Error("не страница");
        progress.bytes += Number(res.headers.get("Content-Length") ?? 0) || 0;
        try {
          await cache.put(job.key, res);
        } catch (e) {
          if (isQuota(e)) throw new QuotaError("Не хватает места на устройстве.");
          throw e;
        }
        if (job.kind === "versioned") {
          // одна копия на файл: старые версии удаляем (как service worker)
          const base = job.key.split("?")[0];
          for (const k of await cache.keys(base, { ignoreSearch: true })) if (k.url !== job.key) await cache.delete(k);
        }
        return;
      } catch (e) {
        if (e instanceof QuotaError || (e as Error)?.name === "AbortError") throw e;
        lastErr = e;
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    throw lastErr ?? new Error("не удалось");
  }

  // несколько загрузок параллельно
  let next = 0;
  let fatal: unknown = null;
  async function lane() {
    while (next < jobs.length && !fatal) {
      const job = jobs[next++];
      try {
        await runJob(job);
      } catch (e) {
        if (e instanceof QuotaError || (e as Error)?.name === "AbortError") {
          fatal = e;
          return;
        }
        progress.failed++;
      }
      progress.done++;
      report();
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, lane));
  if (fatal) throw fatal;

  // seaborn и plotly: их ставит micropip с PyPI — загружаем настоящим Python через service worker
  let micropipMissing: string[] = [];
  if (micropip.length) {
    progress.phase = "python";
    report();
    try {
      if (!controlled) throw new Error("service worker не управляет страницей");
      await prefetchMicropip(micropip, signal);
      micropipMissing = await micropipCached(micropip);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw e;
      micropipMissing = micropip;
    }
    if (micropipMissing.length) progress.failed++;
    progress.done++;
    report();
  }

  progress.phase = "finish";
  report();
  const ok = progress.failed === 0;
  if (ok) await pruneOld(manifest, origin);
  writeOfflineRecord({ version: manifest.version, at: Date.now(), pages: manifest.pages.length, complete: ok });

  let message: string | null = null;
  if (!ok) {
    const parts: string[] = [];
    const filesFailed = progress.failed - (micropipMissing.length ? 1 : 0);
    if (filesFailed > 0) parts.push(`не удалось сохранить файлов: ${filesFailed}`);
    if (micropipMissing.length) parts.push(`не сохранились библиотеки ${micropipMissing.join(" и ")} (уроки с ними без интернета не запустятся)`);
    message = `Курс сохранён не полностью: ${parts.join("; ")}. Нажмите «Скачать» ещё раз — уже сохранённое повторно не загружается.`;
  }
  return { ok, failed: progress.failed, pages: manifest.pages.length, persisted, message };
}

/** После полной загрузки: удалить то, чего нет в новой версии курса (старые файлы сборки, удалённые уроки). */
async function pruneOld(manifest: OfflineManifest, origin: string) {
  const keepStatic = new Set(manifest.static.map((p) => origin + p));
  const keepPages = new Set([...manifest.pages.map((p) => pageKey(p, origin)), pageKey("/offline", origin)]);
  const keepFiles = new Set(manifest.files);
  const prune = async (name: string, drop: (url: URL, href: string) => boolean) => {
    const cache = await caches.open(name);
    for (const req of await cache.keys()) {
      const url = new URL(req.url);
      if (drop(url, req.url)) await cache.delete(req);
    }
  };
  await prune(CACHES.static, (_u, href) => !keepStatic.has(href));
  await prune(CACHES.pages, (u) => u.origin === origin && !keepPages.has(u.origin + u.pathname));
  await prune(CACHES.files, (u) => u.origin === origin && /^\/(data|py|workers)\//.test(u.pathname) && !keepFiles.has(u.pathname));
  // файлы других версий Pyodide и plotly.js. Пакеты текущей версии не трогаем: часть из них (например, narwhals
  // для plotly) подгружает micropip, и в нашем списке их нет; пакеты с PyPI тоже остаются
  await prune(
    CACHES.cdn,
    (_u, href) =>
      (href.startsWith("https://cdn.jsdelivr.net/pyodide/") && !href.startsWith(PYODIDE_INDEX_URL)) ||
      (href.startsWith("https://cdn.jsdelivr.net/npm/") && href !== PLOTLY_SRC)
  );
}
