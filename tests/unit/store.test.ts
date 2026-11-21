// Очередь синхронизации хранилища прогресса: изменения уходят на сервер ровно до подтверждения,
// гонки (изменение во время отправки, «новее» на сервере) не теряют данные.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeItem, type ProgressItem } from "../../src/lib/progress/merge";
import { ProgressStore } from "../../src/lib/progress/store";

/** Минимальный «сервер» Supabase: RPC sync_progress и чтение таблиц, слияние — по тем же правилам. */
function fakeServer() {
  const rows = new Map<string, { data: ProgressItem; updated_at: string }>();
  let tick = 0;
  const stamp = () => new Date(Date.UTC(2026, 10, 8, 12, 0, 0, ++tick)).toISOString();
  const calls = { rpc: 0, sent: [] as string[][] };
  let beforeReply: (() => void) | null = null;
  const sb = {
    async rpc(name: string, args: { p_items: { key: string; data: ProgressItem }[] }) {
      expect(name).toBe("sync_progress");
      calls.rpc++;
      calls.sent.push(args.p_items.map((i) => i.key));
      const items = args.p_items.map(({ key, data }) => {
        const merged = mergeItem(rows.get(key)?.data, data);
        rows.set(key, { data: merged, updated_at: stamp() });
        return { key, data: merged };
      });
      beforeReply?.();
      return { data: { stale: false, epoch: 0, items }, error: null };
    },
    from(table: string) {
      let since: string | null = null;
      const q = {
        select: () => q,
        eq: () => q,
        order: () => q,
        gt: (_col: string, v: string) => {
          since = v;
          return q;
        },
        maybeSingle: async () => ({ data: table === "profiles" ? { progress_epoch: 0 } : null, error: null }),
        range: async () => ({
          data: [...rows.entries()]
            .filter(([, r]) => !since || r.updated_at > since)
            .map(([item_key, r]) => ({ item_key, data: r.data, updated_at: r.updated_at })),
          error: null,
        }),
      };
      return q;
    },
  };
  return {
    sb: sb as unknown as SupabaseClient,
    rows,
    calls,
    /** Подменить данные на сервере «другим устройством». */
    put(key: string, data: ProgressItem) {
      rows.set(key, { data: mergeItem(rows.get(key)?.data, data), updated_at: stamp() });
    },
    onBeforeReply(fn: (() => void) | null) {
      beforeReply = fn;
    },
  };
}

describe("ProgressStore — синхронизация с облаком", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // localStorage браузера: гостевой прогресс и кэш пользователя
    const ls = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => ls.get(k) ?? null,
        setItem: (k: string, v: string) => void ls.set(k, v),
        removeItem: (k: string) => void ls.delete(k),
      },
    });
  });

  it("после отправки очередь пуста, повторная отправка ничего не шлёт", async () => {
    const srv = fakeServer();
    const store = new ProgressStore();
    await store.attachUser(srv.sb, "u1");
    store.update("task:a", () => ({ status: "solved" }));
    store.update("task:b", () => ({ status: "in_progress" }));
    expect(store.pendingCount()).toBe(2);
    await store.push();
    expect(store.pendingCount()).toBe(0);
    expect(store.syncStatus).toBe("idle");
    expect(srv.rows.get("task:a")?.data.status).toBe("solved");
    const before = srv.calls.rpc;
    await store.push();
    expect(srv.calls.rpc).toBe(before);
  });

  it("изменение во время отправки остаётся в очереди и уходит следующей отправкой", async () => {
    const srv = fakeServer();
    const store = new ProgressStore();
    await store.attachUser(srv.sb, "u1");
    store.update("task:a", () => ({ status: "in_progress", attempts: 1 }));
    srv.onBeforeReply(() => {
      srv.onBeforeReply(null);
      vi.advanceTimersByTime(5); // следующее изменение получит более позднюю версию
      store.update("task:a", (p) => ({ ...p, status: "solved", attempts: 2 }));
    });
    await store.push();
    expect(store.pendingCount()).toBe(1);
    await store.push();
    expect(store.pendingCount()).toBe(0);
    expect(srv.rows.get("task:a")?.data).toMatchObject({ status: "solved", attempts: 2 });
  });

  it("неотправленное изменение не теряется, если на сервере версия «новее» (другое устройство, часы впереди)", async () => {
    const srv = fakeServer();
    const store = new ProgressStore();
    await store.attachUser(srv.sb, "u1");
    store.update("task:a", () => ({ status: "solved", attempts: 1 })); // офлайн, ещё не отправлено
    const localAt = store.get("task:a")?.at ?? 0;
    srv.put("task:a", { status: "in_progress", hints: 2, at: localAt + 60_000 });
    await store.pull(); // подтянули раньше, чем отправили
    expect(store.get("task:a")).toMatchObject({ status: "solved", hints: 2 });
    expect(store.pendingCount()).toBe(1);
    await store.push();
    expect(store.pendingCount()).toBe(0);
    expect(srv.rows.get("task:a")?.data).toMatchObject({ status: "solved", hints: 2, attempts: 1 });
  });

  it("данные с сервера без локальных изменений не попадают в очередь", async () => {
    const srv = fakeServer();
    srv.put("task:x", { status: "solved", at: 1000 });
    const store = new ProgressStore();
    await store.attachUser(srv.sb, "u1");
    expect(store.get("task:x")?.status).toBe("solved");
    expect(store.pendingCount()).toBe(0);
    expect(srv.calls.rpc).toBe(0);
  });

  it("прогресс гостя переносится при входе и отправляется в облако", async () => {
    const srv = fakeServer();
    srv.put("task:a", { status: "solved", at: 5 });
    const store = new ProgressStore();
    store.update("task:a", () => ({ status: "in_progress" }));
    store.update("task:b", () => ({ status: "solved" }));
    expect(store.pendingCount()).toBe(0); // гость: облака нет
    const { migrated } = await store.attachUser(srv.sb, "u1");
    expect(migrated).toBe(1); // task:a уже была решена в облаке
    expect(store.pendingCount()).toBe(0);
    expect(srv.rows.get("task:b")?.data.status).toBe("solved");
    expect(srv.rows.get("task:a")?.data.status).toBe("solved");
  });
});
