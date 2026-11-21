"use client";
// Связь страницы с Web Worker, в котором работает Python (Pyodide).
// Запросы выполняются по очереди. Таймаут отсчитывается с момента начала выполнения кода
// (загрузка библиотек и данных не считается). При таймауте или «Стоп» worker завершается и создаётся заново.
// Память движка Pyodide только растёт: если после выполнения она больше порога, Python перезапускается
// в безопасной точке (relieveMemory), где потеря пространств имён ничего не ломает.
// На телефонах и слабых устройствах порог ниже (PY_MEMORY_LIMIT_MOBILE_MB).
import { useSyncExternalStore } from "react";
import { APP_VERSION, PY_MEMORY_LIMIT_MB, PY_MEMORY_LIMIT_MOBILE_MB } from "../config";
import { detectPlatform, pyMemoryLimitMb } from "../pwa/platform";

export interface OutputItem {
  type: "text" | "html" | "image" | "plotly" | "markdown";
  stream?: "stdout" | "stderr";
  text?: string;
  html?: string;
  data?: string;
  json?: string;
}

export interface PyErrorInfo {
  type: string;
  message: string;
  title: string;
  hint: string;
  line: number | null;
  where: string | null;
  traceback: string;
}

export interface RunResult {
  ok: boolean;
  outputs: OutputItem[];
  error: PyErrorInfo | null;
}

export interface CheckResult {
  passed: boolean;
  kind: "passed" | "failed" | "error" | "internal" | null;
  message: string;
  outputs: OutputItem[];
  error: PyErrorInfo | null;
}

export class PyStoppedError extends Error {
  constructor(public reason: "timeout" | "stopped" | "crashed", message: string) {
    super(message);
  }
}

type Phase = "idle" | "loading" | "ready" | "running";
interface PyState {
  phase: Phase;
  text: string;
  generation: number; // растёт при каждом перезапуске Python — пространства имён теряются
  readyMs: number | null;
  memoryRestart: boolean; // текущий Python запущен заново, чтобы освободить память
}

/**
 * Порог памяти в байтах: на телефонах, планшетах и устройствах с памятью до 4 ГБ — PY_MEMORY_LIMIT_MOBILE_MB.
 * Для проверки сквозными тестами его можно занизить: window.__PY_MEMORY_LIMIT_MB = 1.
 */
export function memoryLimitBytes(): number {
  const override = typeof window !== "undefined" ? Number((window as unknown as { __PY_MEMORY_LIMIT_MB?: unknown }).__PY_MEMORY_LIMIT_MB) : NaN;
  if (override > 0) return override * 2 ** 20;
  const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { deviceMemory?: number }) : undefined;
  const { os } = detectPlatform({ userAgent: nav?.userAgent ?? "", maxTouchPoints: nav?.maxTouchPoints ?? 0 });
  return pyMemoryLimitMb(os, nav?.deviceMemory, PY_MEMORY_LIMIT_MB, PY_MEMORY_LIMIT_MOBILE_MB) * 2 ** 20;
}

/** Если сразу после перезапуска ради памяти Python уже занимает больше порога, следующий — после такого роста. */
const MEMORY_REGROWTH = 1.25;

const OFFLINE_PYTHON =
  "Нет подключения к интернету, а Python ещё не сохранён на этом устройстве. Откройте урок, когда появится интернет, или заранее скачайте курс на странице «Приложение».";

/** Ошибка загрузки Python без сети — понятным текстом (ошибки самого кода Python сюда не попадают). */
function offlineAware(message: string): string {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  return offline && /fetch|import|load|network|загрузить|запустить/i.test(message) ? OFFLINE_PYTHON : message;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  timeoutMs: number;
  timer: ReturnType<typeof setTimeout> | null;
  loadTimer: ReturnType<typeof setTimeout> | null;
}

const LOAD_TIMEOUT_MS = 180_000;

export class PyClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private chain: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  private memory: number | null = null; // память движка по последнему ответу worker'а, байт
  private memoryFloor: number | null = null; // память сразу после перезапуска ради памяти (первый ответ нового Python)
  private awaitingFloor = false;
  state: PyState = { phase: "idle", text: "", generation: 0, readyMs: null, memoryRestart: false };

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  getState = () => this.state;
  private set(patch: Partial<PyState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  private spawn(forMemory = false) {
    const w = new Worker(`/workers/py-worker.mjs?v=${encodeURIComponent(APP_VERSION)}`, { type: "module" });
    w.onmessage = (ev: MessageEvent) => this.onMessage(ev.data);
    w.onerror = (ev: ErrorEvent) => {
      ev.preventDefault?.();
      this.crash(offlineAware("Не удалось запустить Python: " + (ev.message || "ошибка загрузки") + ". Проверьте подключение к интернету и обновите страницу."));
    };
    this.worker = w;
    this.memory = null;
    this.memoryFloor = null;
    this.awaitingFloor = forMemory;
    this.set({ generation: this.state.generation + 1, phase: "loading", text: "Готовим Python…", memoryRestart: forMemory });
  }

  private onMessage(msg: { id?: number; type: string; text?: string; ms?: number; result?: unknown; message?: string; memory?: unknown }) {
    const p = msg.id !== undefined ? this.pending.get(msg.id) : undefined;
    switch (msg.type) {
      case "status":
        if (msg.text) this.set({ phase: "loading", text: msg.text });
        break;
      case "ready":
        this.set({ readyMs: msg.ms ?? null, phase: this.pending.size ? "running" : "ready", text: "" });
        break;
      case "started":
        if (p) {
          if (p.loadTimer) clearTimeout(p.loadTimer);
          this.set({ phase: "running", text: "" });
          if (p.timeoutMs > 0) p.timer = setTimeout(() => this.timeout(), p.timeoutMs);
        }
        break;
      case "result":
        if (typeof msg.memory === "number") {
          this.memory = msg.memory;
          if (this.awaitingFloor) {
            this.memoryFloor = msg.memory;
            this.awaitingFloor = false;
          }
        }
        if (p && msg.id !== undefined) {
          this.finish(msg.id);
          p.resolve(msg.result);
        }
        break;
      case "error":
        if (p && msg.id !== undefined) {
          this.finish(msg.id);
          p.reject(new Error(offlineAware(msg.message || "Ошибка Python")));
        }
        break;
    }
  }

  private finish(id: number) {
    const p = this.pending.get(id);
    if (p?.timer) clearTimeout(p.timer);
    if (p?.loadTimer) clearTimeout(p.loadTimer);
    this.pending.delete(id);
    if (!this.pending.size) this.set({ phase: "ready", text: "" });
  }

  private killAll(err: PyStoppedError) {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    for (const [id, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer);
      if (p.loadTimer) clearTimeout(p.loadTimer);
      this.pending.delete(id);
      p.reject(err);
    }
    this.set({ phase: "idle", text: "" });
  }

  private timeout() {
    this.killAll(new PyStoppedError("timeout", "timeout"));
  }

  private crash(message: string) {
    this.killAll(new PyStoppedError("crashed", message));
  }

  /** Остановить выполнение (перезапуск Python). */
  stop() {
    this.killAll(new PyStoppedError("stopped", "stopped"));
  }

  /**
   * Перезапустить Python, если по последнему ответу его память больше порога. Возвращает true, если перезапустил.
   * Вызывать только в безопасной точке: перед запуском или проверкой задания (там всегда свежее пространство имён),
   * перед отправкой решения соревнования и в начале запуска примера урока — LessonRun сравнивает поколение Python
   * и сам выполняет предыдущие примеры заново. Посреди цепочки зависимых примеров вызывать нельзя.
   */
  relieveMemory(): boolean {
    if (typeof window === "undefined" || !this.worker || this.pending.size) return false;
    if (this.memory === null || this.memory <= memoryLimitBytes()) return false;
    // защита от перезапусков по кругу: свежий Python с тяжёлыми библиотеками уже занимает больше порога
    if (this.memoryFloor !== null && this.memory < this.memoryFloor * MEMORY_REGROWTH) return false;
    this.worker.terminate();
    this.worker = null;
    this.spawn(true);
    void this.send({ type: "init" }, 0).catch(() => {});
    return true;
  }

  /** Заранее загрузить Python (например, при открытии урока). */
  preload() {
    if (typeof window === "undefined") return;
    if (!this.worker) {
      this.spawn();
      void this.send({ type: "init" }, 0).catch(() => {});
    }
  }

  private send(msg: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    if (!this.worker) this.spawn();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const p: Pending = { resolve, reject, timeoutMs, timer: null, loadTimer: null };
      p.loadTimer = setTimeout(
        () => this.crash(offlineAware("Python загружается слишком долго. Проверьте подключение к интернету и попробуйте снова.")),
        LOAD_TIMEOUT_MS
      );
      this.pending.set(id, p);
      this.worker!.postMessage({ ...msg, id });
    });
  }

  execute<T>(payload: Record<string, unknown>, timeoutSec: number): Promise<T> {
    const run = () => this.send({ type: "execute", payload }, timeoutSec * 1000) as Promise<T>;
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => {});
    return next;
  }
}

export const py = new PyClient();

export function usePyState(): PyState {
  return useSyncExternalStore(py.subscribe, py.getState, () => py.state);
}

export function stopMessage(e: unknown, timeoutSec: number): string {
  if (e instanceof PyStoppedError) {
    if (e.reason === "timeout")
      return `Код выполнялся дольше ${timeoutSec} с и был остановлен. Возможно, в нём бесконечный цикл (например, while без изменения условия). Python перезапущен — исправьте код и запустите снова.`;
    if (e.reason === "stopped") return "Выполнение остановлено. Python перезапущен.";
    return e.message;
  }
  return (e as Error)?.message || String(e);
}
