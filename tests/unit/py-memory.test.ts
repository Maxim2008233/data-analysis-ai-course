// Перезапуск Python при переполнении памяти: клиент запоминает память движка из ответа worker'а
// и перезапускает Python только по вызову relieveMemory в безопасной точке, когда ничего не выполняется.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryLimitBytes, PyClient } from "@/lib/py/client";

class FakeWorker {
  static all: FakeWorker[] = [];
  posted: Record<string, unknown>[] = [];
  terminated = false;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: unknown = null;
  constructor(public url: string) {
    FakeWorker.all.push(this);
  }
  postMessage(m: Record<string, unknown>) {
    this.posted.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: Record<string, unknown>) {
    this.onmessage?.({ data });
  }
}

const MB = 2 ** 20;
const tick = () => new Promise((r) => setTimeout(r, 0));
const g = globalThis as unknown as { window?: unknown; Worker?: unknown; __PY_MEMORY_LIMIT_MB?: unknown };

beforeEach(() => {
  FakeWorker.all = [];
  g.window = globalThis;
  g.Worker = FakeWorker;
});

afterEach(() => {
  delete g.window;
  delete g.Worker;
  delete g.__PY_MEMORY_LIMIT_MB;
  vi.unstubAllGlobals();
});

/** Ответить на «init», который новый Python получает сразу после перезапуска. */
function answerInit(w: FakeWorker) {
  for (const m of w.posted) if (m.type === "init") w.reply({ type: "result", id: m.id, result: { ok: true } });
}

/** Выполнить запрос и ответить на него от имени worker'а: после выполнения движок занимает memory байт. */
async function runWithMemory(client: PyClient, memory: number) {
  const done = client.execute({ mode: "run", code: "1" }, 10);
  await tick();
  const w = FakeWorker.all[FakeWorker.all.length - 1];
  const msg = w.posted[w.posted.length - 1];
  w.reply({ type: "started", id: msg.id });
  w.reply({ type: "result", id: msg.id, result: { ok: true }, memory });
  return done;
}

describe("перезапуск Python при переполнении памяти", () => {
  it("ниже порога — Python не перезапускается", async () => {
    const c = new PyClient();
    await runWithMemory(c, 500 * MB);
    expect(c.relieveMemory()).toBe(false);
    expect(FakeWorker.all).toHaveLength(1);
    expect(c.state.generation).toBe(1);
  });

  it("выше порога — старый worker завершается, новый сразу готовит Python, поколение меняется", async () => {
    const c = new PyClient();
    await runWithMemory(c, 1100 * MB);
    expect(c.relieveMemory()).toBe(true);
    expect(FakeWorker.all).toHaveLength(2);
    expect(FakeWorker.all[0].terminated).toBe(true);
    expect(FakeWorker.all[1].posted.map((m) => m.type)).toEqual(["init"]);
    expect(c.state.generation).toBe(2);
    expect(c.state.memoryRestart).toBe(true);
    expect(c.relieveMemory()).toBe(false); // память нового Python ещё неизвестна
  });

  it("пока запрос выполняется, Python не перезапускается", async () => {
    const c = new PyClient();
    await runWithMemory(c, 1100 * MB);
    const pending = c.execute({ mode: "run", code: "2" }, 10);
    await tick();
    expect(c.relieveMemory()).toBe(false);
    const w = FakeWorker.all[0];
    const msg = w.posted[w.posted.length - 1];
    w.reply({ type: "result", id: msg.id, result: { ok: true }, memory: 1100 * MB });
    await pending;
    expect(c.relieveMemory()).toBe(true);
  });

  it("порог можно занизить для сквозных тестов через window.__PY_MEMORY_LIMIT_MB", async () => {
    g.__PY_MEMORY_LIMIT_MB = 1;
    const c = new PyClient();
    await runWithMemory(c, 40 * MB);
    expect(c.relieveMemory()).toBe(true);
  });

  it("на iPhone и Android порог ниже, чем на компьютере", async () => {
    expect(memoryLimitBytes()).toBe(1024 * MB);
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });
    expect(memoryLimitBytes()).toBe(640 * MB);
    const c = new PyClient();
    await runWithMemory(c, 700 * MB);
    expect(c.relieveMemory()).toBe(true);
  });

  it("если новый Python сразу занимает больше порога, следующий перезапуск — только после роста на 25 %", async () => {
    const c = new PyClient();
    await runWithMemory(c, 1100 * MB);
    expect(c.relieveMemory()).toBe(true);
    answerInit(FakeWorker.all[1]);
    await runWithMemory(c, 1100 * MB); // тяжёлые библиотеки: свежий Python уже выше порога
    expect(c.relieveMemory()).toBe(false);
    await runWithMemory(c, 1300 * MB);
    expect(c.relieveMemory()).toBe(false);
    await runWithMemory(c, 1400 * MB);
    expect(c.relieveMemory()).toBe(true);
    expect(FakeWorker.all).toHaveLength(3);
  });

  it("после обычной остановки отметка «перезапущен ради памяти» снимается", async () => {
    const c = new PyClient();
    await runWithMemory(c, 1100 * MB);
    c.relieveMemory();
    c.stop();
    await runWithMemory(c, 10 * MB);
    expect(c.state.memoryRestart).toBe(false);
    expect(c.state.generation).toBe(3);
  });
});
