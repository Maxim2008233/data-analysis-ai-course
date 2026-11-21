// Интеграционные тесты соревнований против локального Supabase (npx supabase start):
//   • таблицы соревнований закрыты для учеников и анонимов (RLS без политик), запись — только сервером;
//   • маршруты API (submit, leaderboard) работают целиком: проверка формата, лимит, метрика, места, логины;
//   • удаление аккаунта стирает результаты.
// Маршруты вызываются напрямую как функции (без запуска Next.js). Пропускаются, если .env.local не настроен.
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function loadEnv(): Record<string, string> {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return {};
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const env = loadEnv();
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(URL && ANON && SERVICE);
const COMP = "cars-price";

type Route = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
let submit: Route;
let leaderboard: Route;
let answers: { ids: number[]; prices: number[] };
let zsAnswers: { ids: string[]; classes: string[] };
let qaAnswers: { ids: number[]; scored: number[]; answers: number[] };

function client(): SupabaseClient {
  return createClient(URL!, ANON!, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function newUser() {
  const sb = client();
  const email = `comp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { data, error } = await sb.auth.signUp({ email, password: "test-password-123" });
  if (error) throw error;
  return { sb, id: data.user!.id, token: data.session!.access_token };
}

const ctx = { params: Promise.resolve({ id: COMP }) };
function post(route: Route, body: unknown, headers: Record<string, string> = {}) {
  return route(
    new Request(`http://localhost/api/competitions/${COMP}/x`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }),
    ctx
  );
}
const predictionsWithError = (delta: number) => ({ ids: answers.ids, predictions: answers.prices.map((p) => p + delta) });

// соревнование 2: доля верных классов (больше — лучше)
const ZS = "zero-shot";
const zctx = { params: Promise.resolve({ id: ZS }) };
function postZs(route: Route, body: unknown, headers: Record<string, string> = {}) {
  return route(
    new Request(`http://localhost/api/competitions/${ZS}/x`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }),
    zctx
  );
}
/** Ответы, где первые k картинок отнесены к заведомо неверному классу. */
const zsWithWrong = (k: number) => ({
  ids: zsAnswers.ids,
  predictions: zsAnswers.classes.map((c, i) => (i < k ? (c === "BACKGROUND_Google" ? "Faces" : "BACKGROUND_Google") : c)),
});

// соревнование 3: номера вариантов, оцениваются не все вопросы
const QA = "qa";
const qctx = { params: Promise.resolve({ id: QA }) };
function postQa(route: Route, body: unknown, headers: Record<string, string> = {}) {
  return route(
    new Request(`http://localhost/api/competitions/${QA}/x`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }),
    qctx
  );
}

describe.skipIf(!enabled)("Соревнования: API и база", () => {
  beforeAll(async () => {
    Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE });
    submit = (await import("../../src/app/api/competitions/[id]/submit/route")).POST as Route;
    leaderboard = (await import("../../src/app/api/competitions/[id]/leaderboard/route")).GET as Route;
    answers = JSON.parse(fs.readFileSync(path.join(process.cwd(), "private/competitions/cars-price/answers.json"), "utf8"));
    zsAnswers = JSON.parse(fs.readFileSync(path.join(process.cwd(), "private/competitions/zero-shot/answers.json"), "utf8"));
    qaAnswers = JSON.parse(fs.readFileSync(path.join(process.cwd(), "private/competitions/qa/answers.json"), "utf8"));
  });

  it("таблицы соревнований закрыты для учеников и анонимов", async () => {
    const u = await newUser();
    for (const table of ["competition_entries", "competition_submissions"]) {
      const read = await u.sb.from(table).select("*");
      expect(read.error).not.toBeNull();
      const ins = await u.sb.from(table).insert({ competition_id: COMP, user_id: u.id, best_mae: 1, mae: 1, median_ae: 1 });
      expect(ins.error).not.toBeNull();
      const anon = await client().from(table).select("*");
      expect(anon.error).not.toBeNull();
    }
    const rpc = await u.sb.rpc("record_competition_submission", { p_competition: COMP, p_user: u.id, p_mae: 1, p_median_ae: 1 });
    expect(rpc.error).not.toBeNull();
  });

  it("проверка формата: неполные прогнозы не принимаются", async () => {
    const res = await post(submit, { ids: answers.ids.slice(1), predictions: answers.prices.slice(1) }, { "x-forwarded-for": "10.0.0.1" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Нет прогнозов для 1");
    const bad = await submit(new Request("http://localhost/x", { method: "POST", body: "не json" }), ctx);
    expect(bad.status).toBe(400);
  });

  it("гость: метрика по скрытым ответам и лимит отправок по IP", async () => {
    const ip = { "x-forwarded-for": `10.1.${Math.floor(Math.random() * 250)}.7` };
    const first = await (await post(submit, predictionsWithError(100), ip)).json();
    expect(first).toMatchObject({ ok: true, mae: 100, medianAe: 100, n: answers.ids.length, countedAs: "guest", remaining: 9, leaderboard: null });
    for (let i = 0; i < 9; i++) expect((await post(submit, predictionsWithError(50), ip)).status).toBe(200);
    const blocked = await post(submit, predictionsWithError(50), ip);
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error).toContain("Лимит — 10 отправок за 24 часа");
  });

  it("аккаунт: лучший результат, место, логин в таблице лидеров и удаление аккаунта", async () => {
    const u = await newUser();
    const auth = { Authorization: `Bearer ${u.token}` };
    const r1 = await (await post(submit, predictionsWithError(3000), auth)).json();
    expect(r1).toMatchObject({ ok: true, mae: 3000, countedAs: "account" });
    expect(r1.leaderboard).toMatchObject({ best: 3000, submissions: 1 });
    const r2 = await (await post(submit, predictionsWithError(-20), auth)).json();
    expect(r2.leaderboard).toMatchObject({ best: 20, submissions: 2, place: 1 });
    const r3 = await (await post(submit, predictionsWithError(500), auth)).json();
    expect(r3.leaderboard).toMatchObject({ best: 20, submissions: 3 });
    expect(r3.remaining).toBe(7);

    // аккаунт без логина (как созданные до логинов): строка есть, вместо логина — null, своя строка помечена
    type Row = { login: string | null; score: number; place: number; submissions: number; mine: boolean };
    let board = await (await leaderboard(new Request("http://localhost/x", { headers: auth }), ctx)).json();
    expect(board.enabled).toBe(true);
    expect(board.me).toMatchObject({ score: 20, submissions: 3, login: null, place: 1 });
    expect(board.rows.find((r: Row) => r.mine)).toMatchObject({ login: null, score: 20, place: 1, submissions: 3 });
    expect(JSON.stringify(board)).not.toContain(u.id);

    // ученик задал логин в профиле — таблица показывает его
    const login = `t${Math.random().toString(36).slice(2, 9)}`;
    expect((await u.sb.from("profiles").upsert({ user_id: u.id, username: login }, { onConflict: "user_id" })).error).toBeNull();
    board = await (await leaderboard(new Request("http://localhost/x", { headers: auth }), ctx)).json();
    expect(board.me).toMatchObject({ login, place: 1 });
    expect(board.rows.find((r: Row) => r.mine)).toMatchObject({ login, score: 20 });

    // другой ученик видит этот логин, но строка не его; занятый логин (без учёта регистра) ему не взять
    const other = await newUser();
    const seen = await (await leaderboard(new Request("http://localhost/x", { headers: { Authorization: `Bearer ${other.token}` } }), ctx)).json();
    expect(seen.rows.find((r: Row) => r.login === login)).toMatchObject({ mine: false, score: 20 });
    const taken = await other.sb.from("profiles").upsert({ user_id: other.id, username: login.toUpperCase() }, { onConflict: "user_id" });
    expect(taken.error?.code).toBe("23505");
    // гость видит таблицу без «своей» строки
    const guestBoard = await (await leaderboard(new Request("http://localhost/x"), ctx)).json();
    expect(guestBoard.me).toBeNull();
    expect(guestBoard.rows.some((r: Row) => r.mine)).toBe(false);

    // удаление аккаунта стирает результаты
    expect((await u.sb.rpc("delete_own_account")).error).toBeNull();
    const admin = createClient(URL!, SERVICE!, { auth: { persistSession: false } });
    expect((await admin.from("competition_entries").select("*").eq("user_id", u.id)).data).toEqual([]);
    expect((await admin.from("competition_submissions").select("*").eq("user_id", u.id)).data).toEqual([]);
  });

  it("соревнование 2: доля верных по скрытым классам, неизвестный класс, лучший результат — максимум", async () => {
    const n = zsAnswers.ids.length;
    const ip = { "x-forwarded-for": `10.2.${Math.floor(Math.random() * 250)}.9` };
    const guest = await (await postZs(submit, zsWithWrong(106), ip)).json();
    expect(guest).toMatchObject({ ok: true, metric: "accuracy", correct: n - 106, second: n - 106, n, countedAs: "guest", leaderboard: null });
    expect(guest.score).toBeCloseTo(Math.round(((n - 106) / n) * 1e4) / 1e4, 9);

    const typo = zsWithWrong(0);
    typo.predictions[0] = "flamingo";
    const bad = await postZs(submit, typo, ip);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain("Неизвестные классы у 1 картинок: flamingo");
    const numericIds = await postZs(submit, { ids: zsAnswers.ids.map((_, i) => i), predictions: zsAnswers.classes }, ip);
    expect(numericIds.status).toBe(400);

    const u = await newUser();
    const auth = { Authorization: `Bearer ${u.token}` };
    expect((await (await postZs(submit, zsWithWrong(300), auth)).json()).leaderboard).toMatchObject({ submissions: 1 });
    const perfect = await (await postZs(submit, zsWithWrong(0), auth)).json();
    expect(perfect).toMatchObject({ ok: true, score: 1, correct: n, countedAs: "account" });
    expect(perfect.leaderboard).toMatchObject({ best: 1, submissions: 2, place: 1 });
    const worse = await (await postZs(submit, zsWithWrong(100), auth)).json();
    expect(worse.leaderboard).toMatchObject({ best: 1, submissions: 3, place: 1 });
    const board = await (await leaderboard(new Request("http://localhost/x", { headers: auth }), zctx)).json();
    expect(board.me).toMatchObject({ score: 1, submissions: 3, place: 1 });
    expect((await u.sb.rpc("delete_own_account")).error).toBeNull();
  });

  it("соревнование 3: доля верных только по оцениваемым вопросам, недопустимый номер — неверный ответ, дробный — ошибка", async () => {
    const ip = { "x-forwarded-for": `10.3.${Math.floor(Math.random() * 250)}.7` };
    const truth = new Map(qaAnswers.scored.map((id, k) => [id, qaAnswers.answers[k]]));
    const scoredSet = new Set(qaAnswers.scored);
    // все оцениваемые верны, неоцениваемые — заведомо неверный номер 99: результат 100 %
    const perfect = { ids: qaAnswers.ids, predictions: qaAnswers.ids.map((id) => (scoredSet.has(id) ? truth.get(id)! : 99)) };
    const n = qaAnswers.scored.length;
    const r1 = await (await postQa(submit, perfect, ip)).json();
    expect(r1).toMatchObject({ ok: true, metric: "accuracy", score: 1, correct: n, n, countedAs: "guest" });
    // первые 30 оцениваемых — недопустимый номер 2025 (год): просто неверные ответы
    const firstScored = new Set(qaAnswers.scored.slice(0, 30));
    const years = { ids: qaAnswers.ids, predictions: perfect.predictions.map((p, i) => (firstScored.has(qaAnswers.ids[i]) ? 2025 : p)) };
    const r2 = await (await postQa(submit, years, ip)).json();
    expect(r2).toMatchObject({ ok: true, correct: n - 30 });
    expect(r2.score).toBeCloseTo(Math.round(((n - 30) / n) * 1e4) / 1e4, 9);
    // дробный номер — ошибка формата
    const frac = { ids: qaAnswers.ids, predictions: perfect.predictions.map((p, i) => (i === 0 ? 1.5 : p)) };
    const bad = await postQa(submit, frac, ip);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain("целое число");
  });
});
