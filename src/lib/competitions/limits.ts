// Ограничение числа отправок за скользящие 24 часа.
// Для учеников с аккаунтом счётчик ведёт база (надёжно); для гостей — память серверной функции:
// на Vercel у каждого экземпляра функции своя память, поэтому гостевой лимит — «по возможности».

export const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface LimitState {
  used: number;
  remaining: number;
  /** Через сколько миллисекунд освободится место, если лимит исчерпан (иначе 0). */
  retryAfterMs: number;
}

/** Состояние лимита по отметкам времени прошлых отправок (в мс), без изменения данных. */
export function limitState(stamps: readonly number[], limit: number, now = Date.now()): LimitState {
  const recent = stamps.filter((t) => now - t < WINDOW_MS).sort((a, b) => a - b);
  const used = recent.length;
  const remaining = Math.max(0, limit - used);
  const retryAfterMs = remaining > 0 ? 0 : Math.max(0, recent[used - limit] + WINDOW_MS - now);
  return { used, remaining, retryAfterMs };
}

const MAX_KEYS = 10_000;
const buckets = new Map<string, number[]>();

export const memoryLimiter = {
  state(key: string, limit: number, now = Date.now()): LimitState {
    return limitState(buckets.get(key) ?? [], limit, now);
  },
  record(key: string, now = Date.now()) {
    const kept = (buckets.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    kept.push(now);
    buckets.set(key, kept);
    if (buckets.size > MAX_KEYS) {
      for (const [k, v] of buckets) {
        if (!v.some((t) => now - t < WINDOW_MS)) buckets.delete(k);
        if (buckets.size <= MAX_KEYS / 2) break;
      }
    }
  },
  /** Для тестов. */
  clear() {
    buckets.clear();
  },
};

/** «через 3 ч 15 мин» — для сообщения об исчерпанном лимите. */
export function formatWait(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} ч ${m} мин` : `${m} мин`;
}
