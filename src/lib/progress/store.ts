"use client";
// Хранилище прогресса.
//  * Гость: всё в localStorage (ключ dsc.progress.guest).
//  * Вошедший пользователь: локальный кэш dsc.progress.u:<id> + облако Supabase (таблица progress).
//    Неотправленные изменения — записи, чья версия (поле at) новее версии, подтверждённой сервером (synced).
//    Они отправляются с задержкой (debounce); при обрыве сети — повтор с нарастающей паузой.
//    Слияние на сервере (RPC sync_progress) по тем же правилам, что и здесь.
//  * Несколько вкладок: BroadcastChannel + событие storage; запись в localStorage — «прочитать, слить, записать».
//  * Сброс прогресса на одном устройстве (progress_epoch) очищает кэш на остальных при следующей синхронизации.
import { useSyncExternalStore } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { countNewlySolved, mergeItem, mergeMaps, type ItemsMap, type ProgressItem } from "./merge";

const LS_PREFIX = "dsc.progress.";
const GUEST = "guest";
const PAGE = 1000;

interface Persisted {
  epoch: number;
  items: ItemsMap;
  synced: Record<string, number>; // ключ → версия (at), которую уже подтвердил сервер
  lastPull: string | null;
}

export type SyncStatus = "guest" | "idle" | "syncing" | "offline" | "error";

function emptyState(epoch = 0): Persisted {
  return { epoch, items: {}, synced: {}, lastPull: null };
}

function mergeSynced(a: Record<string, number>, b: Record<string, number>) {
  const res = { ...a };
  for (const [k, v] of Object.entries(b)) res[k] = Math.max(res[k] ?? 0, v);
  return res;
}

function readLS(scope: string): Persisted {
  if (typeof window === "undefined") return emptyState();
  try {
    const raw = window.localStorage.getItem(LS_PREFIX + scope);
    if (!raw) return emptyState();
    const s = JSON.parse(raw) as Partial<Persisted>;
    return {
      epoch: Number(s.epoch ?? 0),
      items: (s.items as ItemsMap) ?? {},
      synced: (s.synced as Record<string, number>) ?? {},
      lastPull: s.lastPull ?? null,
    };
  } catch {
    return emptyState();
  }
}

function writeLS(scope: string, state: Persisted) {
  try {
    window.localStorage.setItem(LS_PREFIX + scope, JSON.stringify(state));
  } catch {
    /* переполнение или запрет хранилища — прогресс останется в памяти вкладки */
  }
}

type RemoteMsg = { scope: string; key?: string; item?: ProgressItem; reset?: boolean };

export class ProgressStore {
  private scope = GUEST;
  private state: Persisted = emptyState();
  private listeners = new Set<() => void>();
  private version = 0;
  private sb: SupabaseClient | null = null;
  private userId: string | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = 2000;
  private pushing = false;
  private pushAgain = false;
  private pulling = false;
  private channel: BroadcastChannel | null = null;
  private initialized = false;
  syncStatus: SyncStatus = "guest";
  lastSyncedAt: number | null = null;
  lastError: string | null = null;

  init() {
    if (this.initialized || typeof window === "undefined") return;
    this.initialized = true;
    this.state = readLS(GUEST);
    if ("BroadcastChannel" in window) {
      this.channel = new BroadcastChannel("dsc-progress");
      this.channel.addEventListener("message", (ev) => this.onRemote(ev.data as RemoteMsg));
    }
    window.addEventListener("storage", (ev) => {
      if (ev.key === LS_PREFIX + this.scope) this.mergeFromStorage();
    });
    window.addEventListener("online", () => {
      this.schedulePush(200);
      void this.pull();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void this.pull();
    });
    setInterval(() => void this.pull(), 120_000);
    this.emit();
  }

  // --- подписка для React ---
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getVersion = () => this.version;
  private emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }
  private setSync(s: SyncStatus, err: string | null = null) {
    this.syncStatus = s;
    this.lastError = err;
    this.emit();
  }

  // --- чтение ---
  get(key: string): ProgressItem | undefined {
    return this.state.items[key];
  }
  all(): ItemsMap {
    return this.state.items;
  }
  private pendingKeys(): string[] {
    if (!this.userId) return [];
    const { items, synced } = this.state;
    return Object.keys(items).filter((k) => (items[k]?.at ?? 0) > (synced[k] ?? 0));
  }
  pendingCount(): number {
    return this.pendingKeys().length;
  }
  isLoggedIn(): boolean {
    return Boolean(this.userId);
  }

  // --- изменение ---
  update(key: string, fn: (prev: ProgressItem | undefined) => ProgressItem) {
    const prev = this.state.items[key];
    const next = fn(prev ? { ...prev } : undefined);
    next.at = Math.max(Date.now(), (prev?.at ?? 0) + 1);
    const merged = mergeItem(prev, next);
    this.state.items = { ...this.state.items, [key]: merged };
    this.save();
    this.emit();
    this.channel?.postMessage({ scope: this.scope, key, item: merged } satisfies RemoteMsg);
    this.schedulePush();
  }

  importItems(items: ItemsMap): number {
    const keys = Object.keys(items);
    this.state.items = this.touch(mergeMaps(this.state.items, items), keys);
    this.save();
    this.emit();
    for (const k of keys) this.channel?.postMessage({ scope: this.scope, key: k, item: this.state.items[k] } satisfies RemoteMsg);
    this.schedulePush(300);
    return keys.length;
  }

  private onRemote(msg: RemoteMsg) {
    if (!msg || msg.scope !== this.scope) return;
    if (msg.reset) {
      this.state = readLS(this.scope);
      this.emit();
      return;
    }
    if (msg.key && msg.item) {
      this.state.items = { ...this.state.items, [msg.key]: mergeItem(this.state.items[msg.key], msg.item) };
      this.emit();
    }
  }

  private mergeFromStorage() {
    const disk = readLS(this.scope);
    if (disk.epoch > this.state.epoch) {
      this.state = disk;
    } else if (disk.epoch === this.state.epoch) {
      this.state.items = mergeMaps(this.state.items, disk.items);
      this.state.synced = mergeSynced(this.state.synced, disk.synced);
    }
    this.emit();
  }

  private confirm(key: string, at: number) {
    if (at > (this.state.synced[key] ?? 0)) this.state.synced = { ...this.state.synced, [key]: at };
  }

  /** Новая версия для объединённых записей — чтобы они точно ушли на сервер. */
  private touch(items: ItemsMap, keys: string[]): ItemsMap {
    const now = Date.now();
    const res = { ...items };
    for (const k of keys) if (res[k]) res[k] = { ...res[k], at: Math.max(now, (res[k].at ?? 0) + 1) };
    return res;
  }

  private save() {
    const disk = readLS(this.scope);
    if (disk.epoch > this.state.epoch) {
      // в другой вкладке прогресс сброшен — принимаем сброс
      this.state = disk;
    } else if (disk.epoch === this.state.epoch) {
      this.state.items = mergeMaps(disk.items, this.state.items);
      this.state.synced = mergeSynced(disk.synced, this.state.synced);
      if (disk.lastPull && (!this.state.lastPull || disk.lastPull > this.state.lastPull)) this.state.lastPull = disk.lastPull;
    }
    writeLS(this.scope, this.state);
  }

  // --- синхронизация с облаком ---
  private schedulePush(delay = 1500) {
    if (!this.sb || !this.userId) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void this.push(), delay);
  }

  async push(): Promise<void> {
    if (!this.sb || !this.userId) return;
    if (this.pushing) {
      this.pushAgain = true;
      return;
    }
    const keys = this.pendingKeys();
    if (!keys.length) {
      if (this.syncStatus !== "idle") this.setSync("idle");
      return;
    }
    this.pushing = true;
    this.setSync("syncing");
    const sentAt: Record<string, number> = {};
    try {
      for (let i = 0; i < keys.length; i += 200) {
        const chunk = keys.slice(i, i + 200);
        const payload = chunk.map((k) => {
          sentAt[k] = this.state.items[k]?.at ?? 0;
          return { key: k, data: this.state.items[k] };
        });
        const { data, error } = await this.sb.rpc("sync_progress", { p_items: payload, p_epoch: this.state.epoch });
        if (error) throw new Error(error.message);
        const res = data as { stale?: boolean; epoch: number; items?: { key: string; data: ProgressItem }[] };
        if (res?.stale) {
          await this.handleStale(res.epoch);
          return;
        }
        const returned = new Set<string>();
        for (const row of res?.items ?? []) {
          returned.add(row.key);
          const local = this.state.items[row.key];
          // пока шёл запрос, запись могла измениться (в этой или другой вкладке) — тогда она остаётся в очереди
          const changedMeanwhile = (local?.at ?? 0) > (sentAt[row.key] ?? 0);
          this.state.items = { ...this.state.items, [row.key]: mergeItem(local, row.data) };
          const confirmed = changedMeanwhile ? (sentAt[row.key] ?? 0) : Math.max(sentAt[row.key] ?? 0, row.data?.at ?? 0);
          this.confirm(row.key, confirmed);
        }
        // запись, которую сервер отклонил как некорректную, повторно не отправляем
        for (const k of chunk) if (!returned.has(k)) this.confirm(k, sentAt[k] ?? 0);
      }
      this.save();
      this.retryDelay = 2000;
      this.lastSyncedAt = Date.now();
      this.setSync("idle");
    } catch (e) {
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      this.setSync(offline ? "offline" : "error", (e as Error).message);
      this.schedulePush(this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 60_000);
    } finally {
      this.pushing = false;
      if (this.pushAgain) {
        this.pushAgain = false;
        this.schedulePush(300);
      }
    }
  }

  /** Отправить всё, что накопилось (перед выходом). */
  async flush(timeoutMs = 4000) {
    if (!this.sb || !this.userId || !this.pendingKeys().length) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    await Promise.race([this.push(), new Promise((r) => setTimeout(r, timeoutMs))]);
  }

  async pull(full = false): Promise<void> {
    if (!this.sb || !this.userId || this.pulling) return;
    this.pulling = true;
    try {
      const { data: prof, error: perr } = await this.sb
        .from("profiles")
        .select("progress_epoch")
        .eq("user_id", this.userId)
        .maybeSingle();
      if (perr) throw new Error(perr.message);
      const serverEpoch = Number(prof?.progress_epoch ?? 0);
      if (serverEpoch > this.state.epoch) {
        this.pulling = false;
        await this.handleStale(serverEpoch);
        return;
      }
      const since = !full && this.state.lastPull ? new Date(Date.parse(this.state.lastPull) - 15_000).toISOString() : null;
      let maxSeen = this.state.lastPull;
      for (let from = 0; ; from += PAGE) {
        let q = this.sb.from("progress").select("item_key,data,updated_at").order("updated_at", { ascending: true });
        if (since) q = q.gt("updated_at", since);
        const { data, error } = await q.range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        for (const row of data ?? []) {
          const key = row.item_key as string;
          const serverItem = row.data as ProgressItem;
          const local = this.state.items[key];
          // неотправленные локальные изменения остаются в очереди, даже если версия на сервере «новее»
          const hasUnsent = (local?.at ?? 0) > (this.state.synced[key] ?? 0);
          this.state.items = { ...this.state.items, [key]: mergeItem(local, serverItem) };
          if (!hasUnsent) this.confirm(key, serverItem?.at ?? 0);
          if (!maxSeen || row.updated_at > maxSeen) maxSeen = row.updated_at;
        }
        if (!data || data.length < PAGE) break;
      }
      this.state.lastPull = maxSeen;
      this.save();
      this.lastSyncedAt = Date.now();
      if (this.syncStatus === "offline" || this.syncStatus === "error") this.setSync("idle");
      else this.emit();
    } catch (e) {
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      this.setSync(offline ? "offline" : "error", (e as Error).message);
    } finally {
      this.pulling = false;
    }
  }

  private async handleStale(epoch: number) {
    // прогресс сброшен на другом устройстве: локальный кэш устарел
    this.state = emptyState(epoch);
    writeLS(this.scope, this.state);
    this.channel?.postMessage({ scope: this.scope, reset: true } satisfies RemoteMsg);
    this.emit();
    await this.pull(true);
  }

  /** Вход: переключиться на кэш пользователя, подтянуть облако, перенести гостевой прогресс. */
  async attachUser(sb: SupabaseClient, userId: string): Promise<{ migrated: number }> {
    if (this.userId === userId) return { migrated: 0 };
    const guest = readLS(GUEST);
    this.sb = sb;
    this.userId = userId;
    this.scope = "u:" + userId;
    this.state = readLS(this.scope);
    this.setSync("syncing");
    await this.pull(true);
    let migrated = 0;
    const guestKeys = Object.keys(guest.items);
    if (guestKeys.length) {
      migrated = countNewlySolved(this.state.items, guest.items);
      this.state.items = this.touch(mergeMaps(this.state.items, guest.items), guestKeys);
      this.save();
      writeLS(GUEST, emptyState(guest.epoch + 1));
      this.channel?.postMessage({ scope: GUEST, reset: true } satisfies RemoteMsg);
      this.emit();
    }
    await this.push();
    if (this.syncStatus === "syncing") this.setSync("idle");
    return { migrated };
  }

  /** Выход: отправить накопленное и переключиться на гостевой режим. */
  async detachUser(opts: { clearCache: boolean }) {
    if (!this.userId) return;
    await this.flush();
    const scope = this.scope;
    this.sb = null;
    this.userId = null;
    this.scope = GUEST;
    if (opts.clearCache) {
      try {
        window.localStorage.removeItem(LS_PREFIX + scope);
      } catch {
        /* ignore */
      }
    }
    this.state = readLS(GUEST);
    this.setSync("guest");
  }

  /** Сбросить весь прогресс (в облаке тоже). */
  async resetAll() {
    if (this.sb && this.userId) {
      const { data, error } = await this.sb.rpc("reset_progress");
      if (error) throw new Error(error.message);
      this.state = emptyState(Number(data ?? this.state.epoch + 1));
    } else {
      this.state = emptyState(this.state.epoch + 1);
    }
    writeLS(this.scope, this.state);
    this.channel?.postMessage({ scope: this.scope, reset: true } satisfies RemoteMsg);
    this.emit();
  }

  /** После удаления аккаунта: забыть пользователя и его кэш. */
  forgetUser() {
    const scope = this.scope;
    this.sb = null;
    this.userId = null;
    this.scope = GUEST;
    try {
      window.localStorage.removeItem(LS_PREFIX + scope);
    } catch {
      /* ignore */
    }
    this.state = readLS(GUEST);
    this.setSync("guest");
  }
}

export const progressStore = new ProgressStore();

export function useProgressVersion(): number {
  return useSyncExternalStore(progressStore.subscribe, progressStore.getVersion, () => 0);
}

export function useProgressItem(key: string): ProgressItem | undefined {
  useProgressVersion();
  return progressStore.get(key);
}

export function useAllProgress(): ItemsMap {
  useProgressVersion();
  return progressStore.all();
}
