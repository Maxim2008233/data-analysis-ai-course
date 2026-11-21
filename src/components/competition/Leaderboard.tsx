"use client";
// Таблица лидеров: лучшие результаты учеников, которые указали имя. Без имени результат учитывается в местах, но скрыт.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { fetchLeaderboard, saveNickname, type LeaderboardResponse } from "@/lib/competitions/client";
import { formatScore, getCompetition } from "@/lib/competitions/registry";

export function Leaderboard({ competition, version }: { competition: string; version: number }) {
  const { user, ready } = useAuth();
  const [board, setBoard] = useState<LeaderboardResponse | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const comp = getCompetition(competition);
  const fmt = (v: number) => (comp ? formatScore(comp, v) : String(v));
  const bestLabel = comp?.metric === "accuracy" ? "Лучшая доля верных" : "Лучший MAE";

  useEffect(() => {
    if (!ready) return;
    let active = true;
    fetchLeaderboard(competition).then((res) => {
      if (!active) return;
      setBoard(res);
      if (res.ok && res.me?.nickname) setName(res.me.nickname);
    });
    return () => {
      active = false;
    };
  }, [ready, user?.id, version, reload, competition]);

  if (!board || (board.ok && !board.enabled)) return null;
  if (!board.ok) {
    return (
      <p className="text-sm text-muted" data-testid="leaderboard-error">
        {board.error}
      </p>
    );
  }

  async function save(nickname: string | null) {
    setSaving(true);
    setMessage(null);
    const res = await saveNickname(competition, nickname);
    setSaving(false);
    if (!res.ok) {
      setMessage(res.error ?? "Не удалось сохранить имя.");
      return;
    }
    setMessage(nickname ? "Имя сохранено." : "Имя скрыто: ваш результат больше не показывается в таблице.");
    if (!nickname) setName("");
    setReload((k) => k + 1);
  }

  const rows = board.rows ?? [];
  const me = board.me;
  return (
    <section className="paper p-4 sm:p-5" data-testid="leaderboard">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="!m-0 font-display text-lg font-semibold">Таблица лидеров</h3>
        <span className="text-sm text-muted">участников с результатом: {board.participants ?? 0}</span>
      </div>
      {rows.length ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm tabular-nums">
            <thead className="text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="py-1 pr-3 font-semibold">Место</th>
                <th className="py-1 pr-3 font-semibold">Участник</th>
                <th className="py-1 pr-3 font-semibold">{bestLabel}</th>
                <th className="py-1 font-semibold">Отправок</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const mine = Boolean(me?.nickname && r.nickname === me.nickname);
                return (
                  <tr key={`${r.place}-${r.nickname}`} className={`border-t border-dashed border-line ${mine ? "bg-accent-soft/40 font-semibold" : ""}`} data-testid="leaderboard-row">
                    <td className="py-1.5 pr-3">{r.place}</td>
                    <td className="py-1.5 pr-3 break-all">{r.nickname}</td>
                    <td className="py-1.5 pr-3">{fmt(r.score)}</td>
                    <td className="py-1.5">{r.submissions}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted">Пока никто не указал имя — станьте первым.</p>
      )}

      <div className="mt-4 border-t border-dashed border-line-strong pt-3 text-sm">
        {!user ? (
          <p className="text-muted">
            Отправлять решения можно и без аккаунта, но в таблицу лидеров попадают только ученики с аккаунтом.{" "}
            <Link href="/login" className="text-accent-ink underline">
              Войти
            </Link>
          </p>
        ) : (
          <>
            {me?.place ? (
              <p data-testid="leaderboard-me">
                Ваше место — <b>{me.place}</b> из {board.participants}, {bestLabel.toLowerCase()} — {fmt(me.score ?? 0)}.
                {!me.nickname && " Без имени результат учитывается в местах, но в таблице не показывается."}
              </p>
            ) : (
              <p className="text-muted">После первой отправки здесь появится ваше место.</p>
            )}
            <form
              className="mt-2 flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void save(name.trim() || null);
              }}
            >
              <label htmlFor={`nick-${competition}`} className="text-muted">
                Имя в таблице:
              </label>
              <input
                id={`nick-${competition}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={24}
                placeholder="например, Маша К."
                className="min-w-0 flex-1 rounded-md border border-line-strong bg-elev px-2.5 py-1.5 outline-none focus:border-accent"
                data-testid="nickname-input"
              />
              <button type="submit" disabled={saving} className="rounded-md border border-line-strong px-3 py-1.5 font-semibold hover:border-accent disabled:opacity-60" data-testid="nickname-save">
                Сохранить
              </button>
              {me?.nickname && (
                <button type="button" disabled={saving} onClick={() => void save(null)} className="rounded-md px-3 py-1.5 text-muted hover:bg-soft hover:text-ink">
                  Скрыть
                </button>
              )}
            </form>
            {message && <p className="mt-1.5 text-xs text-muted">{message}</p>}
            <p className="mt-1.5 text-xs text-muted">Не используйте настоящую фамилию полностью, если не хотите, чтобы её видели другие ученики.</p>
          </>
        )}
      </div>
    </section>
  );
}
