/*
 * Web Worker (модульный) с Python (Pyodide). Интерфейс страницы не зависает, пока выполняется код.
 * Протокол:
 *   страница → worker: { id, type: 'init' } | { id, type: 'execute', payload } | { id, type: 'prefetch', code }
 *   worker → страница: { id, type: 'status', text } | { id, type: 'started' }
 *                      | { id, type: 'result', result, memory } | { id, type: 'error', message } | { type: 'ready', ms }
 * memory — сколько байт занял движок после выполнения: по нему страница решает, не пора ли перезапустить Python.
 * prefetch — загрузить библиотеки для импортов из code, ничего не выполняя: так страница «Приложение» сохраняет
 * для офлайн-режима пакеты, которые ставятся через micropip (src/lib/pwa/offline.ts).
 * Таймаут и остановку выполняет страница: она завершает worker и создаёт новый.
 * Pyodide загружается через import() (CORS-запрос) — работает в браузерах, где importScripts с CDN запрещён.
 */
const PYODIDE_VERSION = "314.0.7";
const INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const APP_VERSION = new URL(self.location.href).searchParams.get("v") || "dev";

let enginePromise = null;
let currentId = null;

const post = (msg) => self.postMessage(msg);
const withVersion = (url) => url + (url.includes("?") ? "&" : "?") + "v=" + encodeURIComponent(APP_VERSION);

async function fetchOk(url) {
  const r = await fetch(withVersion(url));
  if (!r.ok) throw new Error(`Не удалось загрузить ${url} (HTTP ${r.status})`);
  return r;
}

function getEngine() {
  if (!enginePromise) {
    enginePromise = (async () => {
      const t0 = performance.now();
      post({ type: "status", id: currentId, text: "Готовим Python…" });
      const [{ loadPyodide }, { createPyEngine }] = await Promise.all([
        import(`${INDEX_URL}pyodide.mjs`),
        import(withVersion("./py-engine.mjs")),
      ]);
      const pyodide = await loadPyodide({ indexURL: INDEX_URL });
      const engine = createPyEngine(pyodide, {
        pyBase: "/py/",
        dataBase: "/data/",
        stubs: async () => (await fetchOk("/py/stubs/manifest.json")).json(),
        fetchText: async (u) => (await fetchOk(u)).text(),
        fetchBinary: async (u) => new Uint8Array(await (await fetchOk(u)).arrayBuffer()),
        onStatus: (text) => post({ type: "status", id: currentId, text }),
      });
      await engine.init();
      post({ type: "ready", ms: Math.round(performance.now() - t0) });
      return engine;
    })();
    enginePromise.catch(() => {
      enginePromise = null;
    });
  }
  return enginePromise;
}

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  currentId = msg.id;
  try {
    const engine = await getEngine();
    if (msg.type === "init") {
      post({ type: "result", id: msg.id, result: { ok: true } });
      return;
    }
    if (msg.type === "prefetch") {
      await engine.ensurePackages(String(msg.code || ""));
      post({ type: "result", id: msg.id, result: { ok: true }, memory: engine.memoryBytes() });
      return;
    }
    if (msg.type === "execute") {
      const result = await engine.execute(msg.payload, () => post({ type: "started", id: msg.id }));
      post({ type: "result", id: msg.id, result, memory: engine.memoryBytes() });
      return;
    }
    post({ type: "error", id: msg.id, message: "Неизвестная команда: " + msg.type });
  } catch (e) {
    post({ type: "error", id: msg.id, message: String((e && e.message) || e) });
  }
};
