// Серверная часть соревнований: скрытые ответы, проверка пользователя и таблица лидеров.
// Модуль импортируют только route handlers (src/app/api/competitions/...): код и ответы попадают
// в серверную функцию и никогда не отправляются в браузер. Тест tests/unit/competition-leak.test.ts
// проверяет, что ответов нет ни в public/, ни в клиентских файлах сборки.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import carsPriceAnswers from "../../../private/competitions/cars-price/answers.json";
import zeroShotAnswers from "../../../private/competitions/zero-shot/answers.json";
import qaAnswers from "../../../private/competitions/qa/answers.json";

/**
 * Скрытые ответы: цены машин (числовые ID), классы картинок (строковые ID) или номера вариантов теста
 * (ids — все вопросы, scored — оцениваемые, answers — их правильные номера).
 */
export type Answers =
  | { kind: "prices"; ids: number[]; prices: number[] }
  | { kind: "classes"; ids: string[]; classes: string[] }
  | { kind: "choices"; ids: number[]; scored: number[]; answers: number[] };

const ANSWERS: Record<string, Answers> = {
  "cars-price": { kind: "prices", ...(carsPriceAnswers as { ids: number[]; prices: number[] }) },
  "zero-shot": { kind: "classes", ...(zeroShotAnswers as { ids: string[]; classes: string[] }) },
  qa: { kind: "choices", ...(qaAnswers as { ids: number[]; scored: number[]; answers: number[] }) },
};

export function getAnswers(id: string): Answers | null {
  return Object.prototype.hasOwnProperty.call(ANSWERS, id) ? ANSWERS[id] : null;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

/** Таблица лидеров работает, если владелец сайта задал служебный ключ Supabase. */
export const leaderboardEnabled = Boolean(SUPABASE_URL && SERVICE_KEY);

let admin: SupabaseClient | null = null;
function adminClient(): SupabaseClient | null {
  if (!leaderboardEnabled) return null;
  admin ??= createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

let verifier: SupabaseClient | null = null;
function verifyClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !(SERVICE_KEY || SUPABASE_ANON)) return null;
  verifier ??= adminClient() ?? createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  return verifier;
}

/** Пользователь по токену из заголовка Authorization: Bearer <access_token> (токен проверяет Supabase Auth). */
export async function userFromRequest(req: Request): Promise<{ id: string } | null> {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  const client = verifyClient();
  if (!m || !client) return null;
  try {
    const { data, error } = await client.auth.getUser(m[1]);
    if (error || !data.user) return null;
    return { id: data.user.id };
  } catch {
    return null;
  }
}

/** IP клиента (для гостевого лимита). На Vercel первый адрес в x-forwarded-for — адрес клиента. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function recentSubmissionTimes(competitionId: string, userId: string, sinceMs: number): Promise<number[] | null> {
  const db = adminClient();
  if (!db) return null;
  const { data, error } = await db
    .from("competition_submissions")
    .select("created_at")
    .eq("competition_id", competitionId)
    .eq("user_id", userId)
    .gte("created_at", new Date(sinceMs).toISOString());
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => Date.parse(r.created_at as string));
}

/** Лучший результат ученика в базе. loss — величина «меньше — лучше» (MAE или доля ошибок), second — доп. число. */
export interface RecordedResult {
  bestLoss: number;
  bestSecond: number;
  submissions: number;
  place: number;
  participants: number;
}

/** Засчитать отправку. loss — величина «меньше — лучше» (см. toStoredLoss в registry.ts), second — доп. число ≥ 0. */
export async function recordSubmission(competitionId: string, userId: string, loss: number, second: number): Promise<RecordedResult | null> {
  const db = adminClient();
  if (!db) return null;
  const { data, error } = await db.rpc("record_competition_submission", {
    p_competition: competitionId,
    p_user: userId,
    p_mae: loss,
    p_median_ae: second,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    bestLoss: Number(row.best_mae),
    bestSecond: Number(row.best_median_ae),
    submissions: Number(row.submissions),
    place: Number(row.place),
    participants: Number(row.participants),
  };
}

/** Строка таблицы лидеров. loss — хранимая величина «меньше — лучше»; в метрику её переводит fromStoredLoss. */
export interface LeaderboardRow {
  place: number;
  nickname: string;
  loss: number;
  submissions: number;
  bestAt: string | null;
}

export interface Leaderboard {
  rows: LeaderboardRow[];
  participants: number;
  me: { nickname: string | null; loss: number | null; submissions: number; place: number | null } | null;
}

export async function getLeaderboard(competitionId: string, userId: string | null, limit = 20): Promise<Leaderboard | null> {
  const db = adminClient();
  if (!db) return null;
  const [top, scores, mine] = await Promise.all([
    db
      .from("competition_entries")
      .select("nickname, best_mae, submissions, best_at")
      .eq("competition_id", competitionId)
      .not("nickname", "is", null)
      .not("best_mae", "is", null)
      .order("best_mae", { ascending: true })
      .order("best_at", { ascending: true })
      .limit(limit),
    db.from("competition_entries").select("best_mae").eq("competition_id", competitionId).not("best_mae", "is", null),
    userId
      ? db.from("competition_entries").select("nickname, best_mae, submissions").eq("competition_id", competitionId).eq("user_id", userId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  for (const r of [top, scores, mine]) if (r.error) throw new Error(r.error.message);

  // место — среди всех участников с результатом (и тех, кто не показывает имя): 1 + число результатов лучше
  const all = (scores.data ?? []).map((r) => Number(r.best_mae)).sort((a, b) => a - b);
  const placeOf = (mae: number) => {
    let lo = 0;
    let hi = all.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (all[mid] < mae) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };

  const rows: LeaderboardRow[] = (top.data ?? []).map((r) => ({
    place: placeOf(Number(r.best_mae)),
    nickname: String(r.nickname),
    loss: Number(r.best_mae),
    submissions: Number(r.submissions),
    bestAt: (r.best_at as string) ?? null,
  }));
  const m = mine.data as { nickname: string | null; best_mae: number | null; submissions: number } | null;
  const me: Leaderboard["me"] = m
    ? {
        nickname: m.nickname,
        loss: m.best_mae === null ? null : Number(m.best_mae),
        submissions: Number(m.submissions),
        place: m.best_mae === null ? null : placeOf(Number(m.best_mae)),
      }
    : null;
  return { rows, participants: all.length, me };
}

/** Имя в таблице лидеров: 2–24 символа — буквы, цифры, пробел, точка, дефис, подчёркивание. */
export function normalizeNickname(raw: unknown): { ok: true; nickname: string | null } | { ok: false; error: string } {
  if (raw === null || raw === "") return { ok: true, nickname: null };
  if (typeof raw !== "string") return { ok: false, error: "Имя должно быть строкой." };
  const nickname = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (nickname.length < 2 || nickname.length > 24) return { ok: false, error: "Имя — от 2 до 24 символов." };
  if (!/^[\p{L}\p{N} ._-]+$/u.test(nickname)) return { ok: false, error: "В имени можно использовать буквы, цифры, пробел, точку, дефис и подчёркивание." };
  return { ok: true, nickname };
}

export async function setNickname(competitionId: string, userId: string, nickname: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = adminClient();
  if (!db) return { ok: false, error: "Таблица лидеров не настроена." };
  const { error } = await db
    .from("competition_entries")
    .upsert({ competition_id: competitionId, user_id: userId, nickname, updated_at: new Date().toISOString() }, { onConflict: "competition_id,user_id" });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Это имя уже занято — выберите другое." };
    throw new Error(error.message);
  }
  return { ok: true };
}
