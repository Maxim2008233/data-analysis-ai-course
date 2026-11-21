// Перезапуск Python при переполнении памяти: клиент запоминает память движка из ответа worker'а
// и перезапускает Python только по вызову relieveMemory в безопасной точке, когда ничего не выполняется.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PyClient } from "@/lib/py/client";

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
});

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
