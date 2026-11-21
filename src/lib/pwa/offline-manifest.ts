// Список файлов курса для офлайн-режима. Строится один раз при сборке сайта
// (маршрут src/app/offline-files.json/route.ts) и скачивается страницей «Приложение» (src/lib/pwa/offline.ts).
// Только для сервера: читает файлы проекта и результат сборки .next/static.
import fs from "node:fs";
import path from "node:path";
import { APP_VERSION } from "../config";
import { lessonHref, loadCourse } from "../content/load";
import type { OfflineManifest } from "./offline";
import { extractImports } from "./pyodide-lock";

/** Страницы без параметров. */
export const OFFLINE_STATIC_PAGES = [
  "/",
  "/course",
  "/courses",
  "/tasks",
  "/reference",
  "/about",
  "/profile",
  "/app",
  "/offline",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
];

/** Небольшие файлы без версии в адресе: справочник для панели в уроках, манифест приложения, иконки. */
export const OFFLINE_FRESH_FILES = [
  "/api/reference",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icon.svg",
  "/apple-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-192.png",
  "/icons/icon-maskable-512.png",
];

/** Средний размер страницы в кэше (HTML вместе с данными для React), байт: 189 страниц сборки — около 71 МБ. */
const PAGE_BYTES = 380_000;
/** Python: Pyodide (~13 МБ), пакеты курса (~36 МБ), seaborn и plotly с PyPI, plotly.js. */
const PYTHON_BYTES = 70 * 2 ** 20;

function walk(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out.sort();
}

function sizeOf(files: string[], dir: string): number {
  return files.reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
}

export function buildOfflineManifest(root = process.cwd()): OfflineManifest {
  const course = loadCourse();
  const pages = [
    ...OFFLINE_STATIC_PAGES,
    ...course.modules.map((m) => `/course/${m.slug}`),
    ...course.modules.flatMap((m) => m.lessons.map((l) => lessonHref(m.slug, l.slug))),
  ];

  // файлы сборки Next.js: к моменту, когда сборка создаёт этот список, они уже записаны
  const staticDir = path.join(root, ".next", "static");
  const staticRel = walk(staticDir);

  let filesBytes = 0;
  const files: string[] = [];
  for (const dir of ["data", "py", "workers"]) {
    const abs = path.join(root, "public", dir);
    const rel = walk(abs);
    filesBytes += sizeOf(rel, abs);
    files.push(...rel.map((f) => `/${dir}/${f}`));
  }

  // модули Python, которые импортирует код курса: уроки и задания (content), движок и заглушки (public/py)
  const imports = new Set<string>();
  for (const dir of [path.join(root, "content"), path.join(root, "public", "py")]) {
    for (const f of walk(dir)) {
      if (!/\.(md|ya?ml|py)$/.test(f)) continue;
      for (const m of extractImports(fs.readFileSync(path.join(dir, f), "utf8"))) imports.add(m);
    }
  }

  return {
    version: APP_VERSION,
    pages,
    static: staticRel.map((f) => `/_next/static/${f}`),
    files,
    fresh: OFFLINE_FRESH_FILES,
    imports: [...imports].sort(),
    approxBytes: filesBytes + sizeOf(staticRel, staticDir) + pages.length * PAGE_BYTES + PYTHON_BYTES,
  };
}
