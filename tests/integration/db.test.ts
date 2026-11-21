// Интеграционные тесты базы Supabase (локальный стенд: npx supabase start).
// Проверяют: синхронизацию со слиянием, совпадение SQL- и TS-правил слияния, правила доступа (RLS),
// сброс прогресса с эпохой, пределы прогресса на пользователя и удаление аккаунта.
// Пропускаются, если .env.local не настроен.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mergeItem, type ProgressItem } from "../../src/lib/progress/merge";

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

function client(): SupabaseClient {
  return createClient(URL!, ANON!, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function newUser(): Promise<{ sb: SupabaseClient; id: string; email: string; password: string }> {
  const sb = client();
  const email = `it-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = "test-password-123";
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
  if (!data.session) throw new Error("ожидалась сессия сразу после регистрации (подтверждение email выключено локально)");
  return { sb, id: data.user!.id, email, password };
}

describe.skipIf(!enabled)("Supabase: прогресс, слияние, RLS", () => {
  let A: Awaited<ReturnType<typeof newUser>>;
  let B: Awaited<ReturnType<typeof newUser>>;

  beforeAll(async () => {
    A = await newUser();
    B = await newUser();
  });

  it("sync_progress сохраняет и сливает записи по правилам", async () => {
    const r1 = await A.sb.rpc("sync_progress", { p_items: [{ key: "task:t1", data: { status: "solved", attempts: 2, code: "a = 1", codeAt: 100, solvedAt: 100, at: 100 } }], p_epoch: 0 });
    expect(r1.error).toBeNull();
    // более старый код с другого устройства не затирает новый, статус не понижается
    const r2 = await A.sb.rpc("sync_progress", { p_items: [{ key: "task:t1", data: { status: "in_progress", attempts: 5, code: "old", codeAt: 50, at: 200 } }], p_epoch: 0 });
    expect(r2.error).toBeNull();
    const merged = (r2.data as { items: { key: string; data: ProgressItem }[] }).items[0].data;
    expect(merged.status).toBe("solved");
    expect(merged.code).toBe("a = 1");
    expect(merged.attempts).toBe(5);
    const { data } = await A.sb.from("progress").select("item_key,data");
    expect(data?.map((r) => r.item_key)).toEqual(["task:t1"]);
  });

  it("SQL merge_progress совпадает с TS mergeItem на случайных данных", async () => {
    const statuses = [undefined, "not_started", "in_progress", "solved"] as const;
    const rnd = (n: number) => Math.floor(Math.random() * n);
    const make = (): ProgressItem => {
      const it: ProgressItem = {};
      const s = statuses[rnd(4)];
      if (s) it.status = s;
      if (rnd(2)) it.attempts = rnd(10);
      if (rnd(2)) it.hints = rnd(4);
      if (rnd(2)) it.fails = rnd(5);
      if (rnd(2)) it.solutionShown = Boolean(rnd(2));
      if (rnd(2)) it.solvedAt = 1000 + rnd(1000);
      if (rnd(2)) {
        it.code = "c" + rnd(100);
        it.codeAt = rnd(3) ? 1000 + rnd(1000) : undefined;
        if (it.codeAt === undefined) delete it.codeAt;
      }
      if (rnd(2)) it.quiz = { q1: { answer: [rnd(3)], correct: Boolean(rnd(2)), at: rnd(50) }, ...(rnd(2) ? { q2: { answer: [1], correct: true, at: rnd(50) } } : {}) };
      if (rnd(3) === 0) {
        it.best = rnd(5000);
        it.lowerIsBetter = Boolean(rnd(2));
      }
      if (rnd(2)) it.extra = "x" + rnd(10);
      if (rnd(4)) it.at = 1000 + rnd(1000);
      return it;
    };
    for (let i = 0; i < 40; i++) {
      const a = make();
      const b = make();
      const { data, error } = await A.sb.rpc("merge_progress", { a, b });
      expect(error).toBeNull();
      expect(data).toEqual(JSON.parse(JSON.stringify(mergeItem(a, b))));
    }
  });

  it("пользователь Б не видит и не может менять прогресс пользователя А (RLS)", async () => {
    const read = await B.sb.from("progress").select("*").eq("user_id", A.id);
    expect(read.error).toBeNull();
    expect(read.data).toEqual([]);
    const upd = await B.sb.from("progress").update({ data: { status: "not_started" } }).eq("user_id", A.id).select();
    expect(upd.data ?? []).toEqual([]);
    const del = await B.sb.from("progress").delete().eq("user_id", A.id).select();
    expect(del.data ?? []).toEqual([]);
    const ins = await B.sb.from("progress").insert({ user_id: A.id, item_key: "task:hack", data: { status: "solved" } });
    expect(ins.error).not.toBeNull();
    // у А всё на месте
    const mine = await A.sb.from("progress").select("data").eq("item_key", "task:t1").single();
    expect((mine.data?.data as ProgressItem).status).toBe("solved");
    // аноним без входа не видит ничего
    const anon = await client().from("progress").select("*");
    expect(anon.data ?? []).toEqual([]);
  });

  it("сброс прогресса удаляет записи и повышает эпоху; запись со старой эпохой отклоняется", async () => {
    const r = await A.sb.rpc("reset_progress");
    expect(r.error).toBeNull();
    expect(r.data).toBe(1);
    const left = await A.sb.from("progress").select("*");
    expect(left.data).toEqual([]);
    const stale = await A.sb.rpc("sync_progress", { p_items: [{ key: "task:t1", data: { status: "solved", at: 1 } }], p_epoch: 0 });
    expect((stale.data as { stale: boolean }).stale).toBe(true);
    const ok = await A.sb.rpc("sync_progress", { p_items: [{ key: "task:t2", data: { status: "solved", at: 1 } }], p_epoch: 1 });
    expect((ok.data as { stale: boolean }).stale).toBe(false);
  });

  it("предел записей: не больше 3000 на пользователя, обновление существующей записи разрешено", async () => {
    const C = await newUser();
    const admin = createClient(URL!, SERVICE!, { auth: { persistSession: false } });
    const rows = Array.from({ length: 2999 }, (_, i) => ({ user_id: C.id, item_key: `task:q${i}`, data: { status: "in_progress" } }));
    const bulk = await admin.from("progress").insert(rows);
    expect(bulk.error).toBeNull();
    const last = await C.sb.rpc("sync_progress", { p_items: [{ key: "task:q2999", data: { status: "solved", at: 1 } }], p_epoch: 0 });
    expect(last.error).toBeNull();
    const over = await C.sb.rpc("sync_progress", { p_items: [{ key: "task:q3000", data: { status: "solved", at: 1 } }], p_epoch: 0 });
    expect(over.error?.message).toContain("progress quota: too many items");
    const update = await C.sb.rpc("sync_progress", { p_items: [{ key: "task:q5", data: { status: "solved", at: 2 } }], p_epoch: 0 });
    expect(update.error).toBeNull();
    const direct = await C.sb.from("progress").insert({ user_id: C.id, item_key: "task:direct", data: {} });
    expect(direct.error?.message).toContain("progress quota");
    await C.sb.rpc("delete_own_account");
  }, 60_000);

  it("предел объёма: не больше 10 МБ данных прогресса на пользователя", async () => {
    const D = await newUser();
    // случайный текст почти не сжимается: каждая запись занимает около 200 КБ
    const chunk = () => crypto.randomBytes(150_000).toString("base64");
    let saved = 0;
    let quotaError = "";
    for (let i = 0; i < 70; i++) {
      const r = await D.sb.rpc("sync_progress", { p_items: [{ key: `task:big${i}`, data: { code: chunk(), at: 1 } }], p_epoch: 0 });
      if (r.error) {
        quotaError = r.error.message;
        break;
      }
      saved++;
    }
    expect(quotaError).toContain("progress quota: too much data");
    expect(saved).toBeGreaterThanOrEqual(45);
    expect(saved).toBeLessThanOrEqual(55);
    // небольшая правка уже сохранённой записи по-прежнему проходит
    const small = await D.sb.rpc("sync_progress", { p_items: [{ key: "task:big0", data: { status: "solved", at: 2 } }], p_epoch: 0 });
    expect(small.error).toBeNull();
    await D.sb.rpc("delete_own_account");
  }, 60_000);

  it("удаление аккаунта стирает облачные данные и запрещает вход", async () => {
    const del = await A.sb.rpc("delete_own_account");
    expect(del.error).toBeNull();
    const admin = createClient(URL!, SERVICE!, { auth: { persistSession: false } });
    const rows = await admin.from("progress").select("*").eq("user_id", A.id);
    expect(rows.data).toEqual([]);
    const prof = await admin.from("profiles").select("*").eq("user_id", A.id);
    expect(prof.data).toEqual([]);
    const login = await client().auth.signInWithPassword({ email: A.email, password: A.password });
    expect(login.error).not.toBeNull();
  });
});

describe.skipIf(!enabled)("Логины: регистрация, вход по логину, логин у старых аккаунтов", () => {
  const rand = () => Math.random().toString(36).slice(2, 9);
  const password = "test-password-123";

  it("регистрация с логином создаёт профиль; занятый (без учёта регистра) и неверный логин отменяют регистрацию", async () => {
    const login = `u${rand()}`;
    const email = `login-${rand()}@example.com`;
    const sb = client();
    const r = await sb.auth.signUp({ email, password, options: { data: { username: login } } });
    expect(r.error).toBeNull();
    const prof = await sb.from("profiles").select("username").eq("user_id", r.data.user!.id).single();
    expect(prof.data?.username).toBe(login);

    expect((await client().rpc("username_available", { p_username: login.toUpperCase() })).data).toBe(false);
    expect((await client().rpc("username_available", { p_username: `z${rand()}` })).data).toBe(true);
    expect((await client().rpc("username_available", { p_username: "ab" })).data).toBe(false);
    expect((await client().rpc("username_available", { p_username: "Максим" })).data).toBe(false);

    const dup = await client().auth.signUp({ email: `dup-${rand()}@example.com`, password, options: { data: { username: login.toUpperCase() } } });
    expect(dup.error).not.toBeNull();
    const bad = await client().auth.signUp({ email: `bad-${rand()}@example.com`, password, options: { data: { username: "1bad name" } } });
    expect(bad.error).not.toBeNull();
    await sb.rpc("delete_own_account");
  });

  it("вход по логину: почта — только при верном пароле; после 10 ошибок вход по логину приостановлен", async () => {
    const login = `l${rand()}`;
    const email = `login-${rand()}@example.com`;
    const sb = client();
    expect((await sb.auth.signUp({ email, password, options: { data: { username: login } } })).error).toBeNull();

    const ok = await client().rpc("login_email", { p_login: login.toUpperCase(), p_password: password });
    expect(ok.data).toEqual({ status: "ok", email });
    const signIn = await client().auth.signInWithPassword({ email: (ok.data as { email: string }).email, password });
    expect(signIn.error).toBeNull();

    expect((await client().rpc("login_email", { p_login: login, p_password: "wrong-password" })).data).toEqual({ status: "invalid" });
    expect((await client().rpc("login_email", { p_login: `nobody${rand()}`, p_password: password })).data).toEqual({ status: "invalid" });
    expect((await client().rpc("login_email", { p_login: "a@b.c", p_password: password })).data).toEqual({ status: "invalid" });
    for (let i = 0; i < 9; i++) await client().rpc("login_email", { p_login: login, p_password: `wrong-${i}` });
    expect((await client().rpc("login_email", { p_login: login, p_password: password })).data).toEqual({ status: "locked" });
    // вход по почте при этом работает как обычно
    expect((await client().auth.signInWithPassword({ email, password })).error).toBeNull();
    // журнал попыток закрыт для учеников и гостей
    expect((await sb.from("login_attempts").select("*")).error).not.toBeNull();
    expect((await client().from("login_attempts").select("*")).error).not.toBeNull();
    await sb.rpc("delete_own_account");
  });

  it("аккаунт без логина задаёт его в профиле; чужие профили и логины ученику не видны", async () => {
    const C = await newUser(); // регистрация без логина — как у аккаунтов, созданных до логинов
    const before = await C.sb.from("profiles").select("username").eq("user_id", C.id).maybeSingle();
    expect(before.data?.username ?? null).toBeNull();
    const name = `c${rand()}`;
    expect((await C.sb.from("profiles").upsert({ user_id: C.id, username: name }, { onConflict: "user_id" })).error).toBeNull();
    const after = await C.sb.from("profiles").select("username").eq("user_id", C.id).single();
    expect(after.data?.username).toBe(name);
    const badFormat = await C.sb.from("profiles").upsert({ user_id: C.id, username: "1bad" }, { onConflict: "user_id" });
    expect(badFormat.error?.code).toBe("23514");
    const others = await C.sb.from("profiles").select("username").neq("user_id", C.id);
    expect(others.data ?? []).toEqual([]);
    // по новому логину можно войти
    const ok = await client().rpc("login_email", { p_login: name, p_password: C.password });
    expect(ok.data).toEqual({ status: "ok", email: C.email });
    await C.sb.rpc("delete_own_account");
  });
});
