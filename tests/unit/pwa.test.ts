// Офлайн-режим и установка приложения (PWA): распознавание устройства, порог памяти Python, пакеты Pyodide
// для скачивания курса, маршрутизация запросов в service worker и согласованность настроек между файлами.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { detectPlatform, pyMemoryLimitMb } from "@/lib/pwa/platform";
import { extractImports, resolvePyodidePackages, type PyodideLock } from "@/lib/pwa/pyodide-lock";
import { CACHES, pageKey } from "@/lib/pwa/caches";
import { buildOfflineManifest } from "@/lib/pwa/offline-manifest";
import { PY_MICROPIP_MODULES, PYODIDE_CORE_FILES, PYODIDE_INDEX_URL, PYODIDE_VERSION } from "@/lib/config";

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.119 Mobile/15E148 Safari/604.1",
  iphoneYandex:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 YaBrowser/25.6.5.400.10 SA/3 Mobile/15E148 Safari/604.1",
  ipadDesktopMode: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
  androidChrome: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
  androidSamsung:
    "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
  androidYandex:
    "Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 YaBrowser/25.6.1.88.00 SA/3 Mobile Safari/537.36",
  androidFirefox: "Mozilla/5.0 (Android 15; Mobile; rv:141.0) Gecko/141.0 Firefox/141.0",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0",
  macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
};

describe("detectPlatform", () => {
  it.each([
    ["iphoneSafari", 5, "ios", "safari"],
    ["iphoneChrome", 5, "ios", "chrome"],
    ["iphoneYandex", 5, "ios", "yandex"],
    ["ipadDesktopMode", 5, "ios", "safari"], // iPadOS 13+ притворяется Mac, но экран сенсорный
    ["ipadDesktopMode", 0, "desktop", "safari"], // настоящий Mac
    ["androidChrome", 5, "android", "chrome"],
    ["androidSamsung", 5, "android", "samsung"],
    ["androidYandex", 5, "android", "yandex"],
    ["androidFirefox", 5, "android", "firefox"],
    ["windowsEdge", 0, "desktop", "edge"],
    ["macChrome", 0, "desktop", "chrome"],
  ] as const)("%s (касаний: %i) → %s, %s", (name, touch, os, browser) => {
    const p = detectPlatform({ userAgent: UA[name], maxTouchPoints: touch });
    expect(p.os).toBe(os);
    expect(p.browser).toBe(browser);
  });

  it("пустой userAgent — компьютер, браузер неизвестен", () => {
    expect(detectPlatform({ userAgent: "" })).toEqual({ os: "desktop", browser: "other", standalone: false });
  });
});

describe("порог памяти Python для устройства", () => {
  it("телефоны и планшеты — пониже", () => {
    expect(pyMemoryLimitMb("ios", undefined, 1024, 640)).toBe(640);
    expect(pyMemoryLimitMb("android", 8, 1024, 640)).toBe(640);
  });
  it("компьютер с памятью до 4 ГБ — как телефон, остальные — обычный порог", () => {
    expect(pyMemoryLimitMb("desktop", 4, 1024, 640)).toBe(640);
    expect(pyMemoryLimitMb("desktop", 2, 1024, 640)).toBe(640);
    expect(pyMemoryLimitMb("desktop", 8, 1024, 640)).toBe(1024);
    expect(pyMemoryLimitMb("desktop", undefined, 1024, 640)).toBe(1024); // Safari и Firefox не сообщают память
  });
});

describe("extractImports", () => {
  it("import и from … import, несколько модулей, подмодули, псевдонимы, отступы", () => {
    const code = [
      "import numpy as np, pandas as pd",
      "from sklearn.model_selection import train_test_split",
      "    import matplotlib.pyplot as plt",
      "from . import local",
      "x = 1  # import os — в комментарии не считается",
      "from collections import Counter",
    ].join("\n");
    expect(extractImports(code)).toEqual(["collections", "matplotlib", "numpy", "pandas", "sklearn"]);
  });
});

describe("resolvePyodidePackages", () => {
  const lock = JSON.parse(read("node_modules/pyodide/pyodide-lock.json")) as PyodideLock;

  it("пакеты курса вместе с зависимостями (Pyodide 314.0.7)", () => {
    const files = resolvePyodidePackages(lock, ["numpy", "pandas", "matplotlib", "sklearn", "scipy", "lightgbm", "jinja2", "micropip", "os", "json"]);
    const names = files.map((f) => f.split("-")[0].toLowerCase());
    expect(names).toEqual(
      [
        "contourpy",
        "cycler",
        "fonttools",
        "jinja2",
        "joblib",
        "kiwisolver",
        "lightgbm",
        "markupsafe",
        "matplotlib",
        "micropip",
        "numpy",
        "packaging",
        "pandas",
        "pillow",
        "pyparsing",
        "python_dateutil",
        "pytz",
        "scikit_learn",
        "scipy",
        "six",
        "threadpoolctl",
      ].sort()
    );
  });

  it("имена сравниваются без учёта регистра и «-»/«_», циклы зависимостей не мешают", () => {
    const fake: PyodideLock = {
      packages: {
        "my-pkg": { name: "My_Pkg", file_name: "my_pkg.whl", imports: ["mypkg"], depends: ["Dep_A"] },
        "dep-a": { name: "dep-a", file_name: "dep_a.whl", depends: ["my-pkg"] },
        other: { name: "other", file_name: "other.whl" },
      },
    };
    expect(resolvePyodidePackages(fake, ["mypkg"])).toEqual(["dep_a.whl", "my_pkg.whl"]);
    expect(resolvePyodidePackages(fake, ["unknown"])).toEqual([]);
  });
});

describe("список файлов курса для офлайна", () => {
  const m = buildOfflineManifest(ROOT);

  it("все уроки, модули и служебные страницы, без повторов", () => {
    expect(new Set(m.pages).size).toBe(m.pages.length);
    for (const p of ["/", "/course", "/app", "/offline", "/reference", "/tasks"]) expect(m.pages).toContain(p);
    expect(m.pages.filter((p) => p.startsWith("/learn/")).length).toBeGreaterThan(100);
  });

  it("каждая страница из списка есть в последней сборке (если сайт собран)", () => {
    const appDir = path.join(ROOT, ".next/server/app");
    if (!fs.existsSync(appDir)) return;
    const missing = m.pages.filter((p) => !fs.existsSync(path.join(appDir, (p === "/" ? "/index" : p) + ".html")));
    // /app и /offline появились вместе с PWA: в старой сборке их может не быть
    expect(missing.filter((p) => p !== "/app" && p !== "/offline")).toEqual([]);
  });

  it("данные, Python и worker — из public, файлы сборки существуют", () => {
    for (const f of ["/data/cars.csv", "/py/runner.py", "/py/stubs/manifest.json", "/workers/py-worker.mjs", "/workers/py-engine.mjs"]) {
      expect(m.files).toContain(f);
    }
    for (const f of m.static) expect(fs.existsSync(path.join(ROOT, ".next/static", f.replace("/_next/static/", "")))).toBe(true);
    expect(m.fresh).toContain("/api/reference");
  });

  it("пакеты Python курса — все, что загружал валидатор контента, плюс seaborn и plotly через micropip", () => {
    const lock = JSON.parse(read("node_modules/pyodide/pyodide-lock.json")) as PyodideLock;
    const files = resolvePyodidePackages(lock, [...m.imports, "jinja2", "micropip"]);
    for (const name of ["numpy-", "pandas-", "matplotlib-", "scikit_learn-", "scipy-", "lightgbm-", "jinja2-", "micropip-"]) {
      expect(files.some((f) => f.startsWith(name))).toBe(true);
    }
    for (const mod of PY_MICROPIP_MODULES) expect(m.imports).toContain(mod);
    expect(m.approxBytes).toBeGreaterThan(100 * 2 ** 20);
  });
});

// ---------------------------------------------------------------- service worker
interface FakeRequest {
  url: string;
  method: string;
  mode: string;
  headers: { get(name: string): string | null };
}

function loadServiceWorker() {
  const self: Record<string, unknown> = {
    location: new URL("https://site.test/sw.js"),
    addEventListener: () => {},
    registration: {},
    clients: {},
  };
  vm.runInNewContext(read("public/sw.js"), { self, URL, Response, caches: {}, fetch: () => {}, setTimeout, clearTimeout, console });
  return {
    route: self.__dscRoute as (r: FakeRequest) => string | null,
    pageKey: self.__dscPageKey as (href: string) => string,
  };
}

function req(url: string, opts: { method?: string; mode?: string; headers?: Record<string, string> } = {}): FakeRequest {
  const h = Object.fromEntries(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    url: new URL(url, "https://site.test").href,
    method: opts.method ?? "GET",
    mode: opts.mode ?? "cors",
    headers: { get: (name) => h[name.toLowerCase()] ?? null },
  };
}

describe("service worker: что и как кэшируется", () => {
  const sw = loadServiceWorker();

  it.each([
    // страницы — сначала сеть
    [req("/learn/m01-numpy/l01-arrays", { mode: "navigate" }), "page"],
    [req("/", { mode: "navigate" }), "page"],
    [req("/login?next=/profile", { mode: "navigate" }), "page"],
    // служебные запросы Next.js — мимо
    [req("/learn/m01/l01?_rsc=abc12", { mode: "cors" }), null],
    [req("/learn/m01/l01", { mode: "cors", headers: { RSC: "1" } }), null],
    [req("/course", { headers: { "Next-Router-Prefetch": "1" } }), null],
    // сборка, данные, Python
    [req("/_next/static/chunks/abc.js"), "static"],
    [req("/_next/static/media/font.woff2"), "static"],
    [req("/data/cars.csv?v=1a2b3c4d"), "versioned"],
    [req("/py/runner.py?v=1a2b3c4d"), "versioned"],
    [req("/workers/py-worker.mjs?v=1a2b3c4d", { mode: "same-origin" }), "versioned"],
    [req("/data/cars.csv"), "fresh"],
    [req("/data/competition_cars_sample_submission.csv", { mode: "navigate" }), null],
    [req("https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.asm.wasm"), "immutable"],
    [req("https://cdn.jsdelivr.net/npm/plotly.js-dist-min@4.1.1/plotly.min.js"), "immutable"],
    [req("https://files.pythonhosted.org/packages/83/11/seaborn-0.13.2-py3-none-any.whl"), "immutable"],
    [req("https://pypi.org/pypi/seaborn/json"), "fresh"],
    [req("https://pypi.org/simple/plotly/"), "fresh"],
    // небольшие файлы без версии
    [req("/api/reference"), "fresh"],
    [req("/manifest.webmanifest"), "fresh"],
    [req("/icons/icon-192.png"), "fresh"],
    [req("/icon.svg?a1b2c3"), "fresh"],
    // никогда не кэшируется
    [req("/api/competitions/cars-price/leaderboard"), null],
    [req("/api/competitions/cars-price/submit", { method: "POST" }), null],
    [req("https://abcd.supabase.co/rest/v1/progress?select=*"), null],
    [req("https://abcd.supabase.co/auth/v1/token?grant_type=refresh_token", { method: "POST" }), null],
    [req("https://github.com/Maxim2008233/data-analysis-ai-course/issues/new", { mode: "navigate" }), null],
    [req("/sw.js"), null],
    [req("/offline-files.json"), null],
    [req("/some/unknown.txt"), null],
  ])("%j → %s", (r, expected) => {
    expect(sw.route(r)).toBe(expected);
  });

  it("ключ страницы — без query и якоря", () => {
    expect(sw.pageKey("https://site.test/learn/a/b?x=1#task-3")).toBe("https://site.test/learn/a/b");
    expect(pageKey("/learn/a/b?x=1#task-3", "https://site.test")).toBe("https://site.test/learn/a/b");
  });
});

describe("согласованность настроек между файлами", () => {
  it("названия кэшей в public/sw.js и src/lib/pwa/caches.ts совпадают", () => {
    const src = read("public/sw.js");
    const val = (name: string) => new RegExp(`var ${name} = "([^"]+)"`).exec(src)?.[1];
    expect({ pages: val("CACHE_PAGES"), static: val("CACHE_STATIC"), files: val("CACHE_FILES"), cdn: val("CACHE_CDN") }).toEqual(CACHES);
  });

  it("адрес Pyodide в worker'е совпадает с настройками сайта", () => {
    const worker = read("public/workers/py-worker.mjs");
    expect(/const PYODIDE_VERSION = "([^"]+)"/.exec(worker)?.[1]).toBe(PYODIDE_VERSION);
    expect(worker).toContain("https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/");
    expect(PYODIDE_INDEX_URL).toBe(`https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`);
  });

  it("файлы ядра Pyodide из настроек есть в пакете pyodide этой версии", () => {
    for (const f of PYODIDE_CORE_FILES) expect(fs.existsSync(path.join(ROOT, "node_modules/pyodide", f))).toBe(true);
    expect(JSON.parse(read("node_modules/pyodide/package.json")).version).toBe(PYODIDE_VERSION);
  });

  it("пакеты micropip в движке и в настройках — одни и те же", () => {
    const engine = read("public/workers/py-engine.mjs");
    const block = /MICROPIP_PACKAGES = \{([^}]+)\}/.exec(engine)?.[1] ?? "";
    const names = [...block.matchAll(/(\w+):\s*"/g)].map((x) => x[1]).sort();
    expect(names).toEqual([...PY_MICROPIP_MODULES].sort());
  });
});
