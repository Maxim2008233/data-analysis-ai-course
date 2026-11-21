/*
 * Service worker «Лаборатории данных»: офлайн-режим сайта и установленного приложения (PWA).
 * Регистрирует его src/components/pwa/PwaRegister.tsx (только в сборке для продакшена).
 *
 * Как отвечает на запросы (функция route ниже):
 *   page       страницы сайта: сначала сеть (онлайн всё всегда свежее), свежая копия сохраняется. Без сети
 *              или если сеть молчит дольше NAV_TIMEOUT_MS — сохранённая копия; если копии нет — страница /offline;
 *   static     /_next/static/… — в имени файла хеш содержимого, файл никогда не меняется: сначала кэш;
 *   versioned  /data, /py, /workers с ?v=<версия сайта>: хранится одна копия каждого файла — нужная версия
 *              из кэша, иначе из сети (новая заменяет старую), а без сети — та версия, что есть;
 *   immutable  Python (Pyodide) и plotly.js с jsDelivr, пакеты с files.pythonhosted.org — в адресе есть версия:
 *              сначала кэш;
 *   fresh      справочник /api/reference (статический JSON), манифест и иконки, метаданные PyPI: сначала сеть,
 *              без сети — сохранённая копия;
 *   null       всё остальное идёт в сеть мимо service worker и никогда не сохраняется: вход и прогресс
 *              (Supabase), соревнования (/api/competitions), служебные запросы Next.js (RSC), всё, кроме GET.
 *
 * Весь курс целиком скачивает страница «Приложение» (src/lib/pwa/offline.ts): она кладёт файлы в те же кэши
 * с теми же ключами. Названия кэшей совпадают с src/lib/pwa/caches.ts (проверяет tests/unit/pwa.test.ts).
 * Как выключить офлайн-режим — DEPLOY.md, раздел «Офлайн-режим и приложение (PWA)».
 */
"use strict";

var CACHE_PAGES = "dsc-pages-v1";
var CACHE_STATIC = "dsc-static-v1";
var CACHE_FILES = "dsc-files-v1";
var CACHE_CDN = "dsc-cdn-v1";
var OUR_CACHES = [CACHE_PAGES, CACHE_STATIC, CACHE_FILES, CACHE_CDN];
var CACHE_PREFIX = "dsc-";

var OFFLINE_PATH = "/offline";
var NAV_TIMEOUT_MS = 6000;

// адреса с версией внутри: файл по такому адресу не меняется
var IMMUTABLE_PREFIXES = ["https://cdn.jsdelivr.net/pyodide/", "https://cdn.jsdelivr.net/npm/", "https://files.pythonhosted.org/"];
// метаданные пакетов для micropip (seaborn, plotly): меняются, но без сети годится и сохранённая копия
var FRESH_PREFIXES = ["https://pypi.org/"];
var VERSIONED_DIRS = ["/data/", "/py/", "/workers/"];
var FRESH_PATHS = ["/api/reference", "/manifest.webmanifest", "/favicon.ico", "/icon.svg", "/apple-icon.png"];

// файлы сборки Next.js, на которые ссылается страница (в том числе внутри данных RSC: там кавычки экранированы)
var STATIC_RE = /\/_next\/static\/[^"'\s\\<>()]+/g;

function noop() {}

function startsWithAny(s, prefixes) {
  for (var i = 0; i < prefixes.length; i++) if (s.indexOf(prefixes[i]) === 0) return true;
  return false;
}

/** Какой стратегией отвечать на запрос (см. шапку файла); null — не вмешиваться. */
function route(req) {
  if (req.method !== "GET") return null;
  var url = new URL(req.url);
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.origin !== self.location.origin) {
    if (startsWithAny(url.href, IMMUTABLE_PREFIXES)) return "immutable";
    if (startsWithAny(url.href, FRESH_PREFIXES)) return "fresh";
    return null;
  }
  // данные для переходов внутри сайта без перезагрузки. Без сети запрос не удастся,
  // и Next.js сам откроет страницу обычным переходом — её отдаст ветка page
  if (url.searchParams.has("_rsc") || req.headers.get("RSC") === "1" || req.headers.get("Next-Router-Prefetch")) return null;
  var path = url.pathname;
  if (path === "/sw.js") return null;
  if (path.indexOf("/api/") === 0) return path === "/api/reference" ? "fresh" : null;
  if (path.indexOf("/_next/static/") === 0) return "static";
  if (startsWithAny(path, VERSIONED_DIRS)) {
    if (req.mode === "navigate") return null; // ссылки «скачать файл» — как обычно
    return url.searchParams.has("v") ? "versioned" : "fresh";
  }
  if (req.mode === "navigate") return path.indexOf("/_next/") === 0 ? null : "page";
  if (FRESH_PATHS.indexOf(path) >= 0 || path.indexOf("/icons/") === 0) return "fresh";
  return null;
}

/** Ключ страницы в кэше: адрес без ?query (страницы статические, query на них не влияет). */
function pageKey(href) {
  var url = new URL(href, self.location.origin);
  return url.origin + url.pathname;
}

function isCacheablePage(res) {
  return (
    !!res &&
    res.status === 200 &&
    res.type === "basic" &&
    !res.redirected &&
    (res.headers.get("Content-Type") || "").indexOf("text/html") === 0
  );
}

function isCacheable(res) {
  return !!res && res.status === 200 && (res.type === "basic" || res.type === "cors");
}

/** Ответ сети, если он пришёл за ms и это не ошибка сервера; иначе — сохранённая копия. */
function networkOrCached(network, cached, ms) {
  return new Promise(function (resolve) {
    var timer = setTimeout(function () {
      resolve(cached);
    }, ms);
    network.then(
      function (res) {
        clearTimeout(timer);
        resolve(res.status >= 500 ? cached : res);
      },
      function () {
        clearTimeout(timer);
        resolve(cached);
      }
    );
  });
}

var OFFLINE_HTML =
  '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  "<title>Нет подключения — Лаборатория данных</title></head>" +
  '<body style="font-family:system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem;line-height:1.55;background:#f4efe4;color:#1c2430">' +
  "<h1>Нет подключения к интернету</h1><p>Эта страница ещё не сохранена на устройстве. Подключитесь к интернету и обновите страницу.</p>" +
  '<p><a href="/course">Оглавление курса</a></p></body></html>';

async function offlineFallback(req) {
  var url = new URL(req.url);
  if (url.pathname !== OFFLINE_PATH) {
    var cache = await caches.open(CACHE_PAGES);
    var page = await cache.match(self.location.origin + OFFLINE_PATH, { ignoreVary: true });
    // переходим на /offline?from=…: страница покажет сохранённые уроки и кнопку «Попробовать снова»
    if (page) return Response.redirect(OFFLINE_PATH + "?from=" + encodeURIComponent(url.pathname + url.search), 302);
  }
  return new Response(OFFLINE_HTML, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function handlePage(event) {
  var req = event.request;
  var key = pageKey(req.url);
  // navigation preload: браузер начинает загрузку страницы, пока запускается service worker
  var network = Promise.resolve(event.preloadResponse)
    .catch(noop)
    .then(function (preloaded) {
      return preloaded || fetch(req);
    });
  // копию сохраняем, даже если ответили сохранённой версией: пусть следующий раз будет свежая
  event.waitUntil(
    network
      .then(function (res) {
        if (!isCacheablePage(res)) return;
        var copy = res.clone();
        return caches.open(CACHE_PAGES).then(function (cache) {
          return cache.put(key, copy);
        });
      })
      .catch(noop)
  );
  return (async function () {
    var cache = await caches.open(CACHE_PAGES);
    var cached = await cache.match(key, { ignoreVary: true });
    if (!cached) {
      try {
        return await network;
      } catch {
        return offlineFallback(req);
      }
    }
    if (self.navigator && self.navigator.onLine === false) return cached;
    return networkOrCached(network, cached, NAV_TIMEOUT_MS);
  })();
}

async function cacheFirst(event, cacheName) {
  var req = event.request;
  var cache = await caches.open(cacheName);
  var hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  var res = await fetch(req);
  if (isCacheable(res)) event.waitUntil(cache.put(req, res.clone()).catch(noop));
  return res;
}

async function networkFirst(event, cacheName, ignoreSearch) {
  var req = event.request;
  var cache = await caches.open(cacheName);
  try {
    var res = await fetch(req);
    if (isCacheable(res)) event.waitUntil(cache.put(req, res.clone()).catch(noop));
    return res;
  } catch (err) {
    var hit = await cache.match(req, { ignoreVary: true, ignoreSearch: !!ignoreSearch });
    if (hit) return hit;
    throw err;
  }
}

/** Одна копия файла на путь: точная версия, иначе сеть (заменяет старую), без сети — что есть. */
async function handleVersioned(event) {
  var req = event.request;
  var url = new URL(req.url);
  var cache = await caches.open(CACHE_FILES);
  var exact = await cache.match(req, { ignoreVary: true });
  if (exact) return exact;
  var others = await cache.keys(url.origin + url.pathname, { ignoreSearch: true });
  try {
    var res = await fetch(req);
    if (isCacheable(res)) {
      var copy = res.clone();
      event.waitUntil(
        (async function () {
          await cache.put(req, copy);
          for (var i = 0; i < others.length; i++) if (others[i].url !== req.url) await cache.delete(others[i]);
        })().catch(noop)
      );
    }
    return res;
  } catch (err) {
    for (var j = 0; j < others.length; j++) {
      var old = await cache.match(others[j], { ignoreVary: true });
      if (old) return old;
    }
    throw err;
  }
}

/** Сохранить страницу /offline и файлы, без которых она не отрисуется. */
async function saveOfflinePage() {
  var res = await fetch(OFFLINE_PATH, { cache: "no-cache", credentials: "same-origin" });
  if (!isCacheablePage(res)) return;
  var html = await res.clone().text();
  var pages = await caches.open(CACHE_PAGES);
  await pages.put(self.location.origin + OFFLINE_PATH, res);
  var assets = html.match(STATIC_RE) || [];
  var statics = await caches.open(CACHE_STATIC);
  var seen = {};
  await Promise.all(
    assets.map(async function (path) {
      if (seen[path]) return;
      seen[path] = true;
      if (await statics.match(path)) return;
      var r = await fetch(path);
      if (isCacheable(r)) await statics.put(path, r);
    })
  );
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    saveOfflinePage()
      .catch(noop)
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    (async function () {
      var names = await caches.keys();
      await Promise.all(
        names
          .filter(function (n) {
            return n.indexOf(CACHE_PREFIX) === 0 && OUR_CACHES.indexOf(n) < 0;
          })
          .map(function (n) {
            return caches.delete(n);
          })
      );
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(noop);
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", function (event) {
  var data = event.data || {};
  // после выхода новой версии сайта страница просит обновить сохранённую /offline
  if (data.type === "refresh-offline-page") event.waitUntil(saveOfflinePage().catch(noop));
});

self.addEventListener("fetch", function (event) {
  var kind = null;
  try {
    kind = route(event.request);
  } catch {
    kind = null;
  }
  if (!kind) return;
  var sameOrigin = new URL(event.request.url).origin === self.location.origin;
  var answer;
  if (kind === "page") answer = handlePage(event);
  else if (kind === "static") answer = cacheFirst(event, CACHE_STATIC);
  else if (kind === "versioned") answer = handleVersioned(event);
  else if (kind === "immutable") answer = cacheFirst(event, CACHE_CDN);
  else answer = networkFirst(event, sameOrigin ? CACHE_FILES : CACHE_CDN, sameOrigin);
  event.respondWith(answer);
});

// для модульных тестов (tests/unit/pwa.test.ts)
self.__dscRoute = route;
self.__dscPageKey = pageKey;
