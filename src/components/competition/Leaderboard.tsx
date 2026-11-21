"use client";
// Таблица лидеров: лучшие результаты учеников с аккаунтом, по логинам. Логин задаётся при регистрации или в профиле.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { fetchLeaderboard, type LeaderboardResponse } from "@/lib/competitions/client";
import { formatScore, getCompetition } from "@/lib/competitions/registry";

export function Leaderboard({ competition, version }: { competition: string; version: number }) {
  const { user, username, ready } = useAuth();
  const [board, setBoard] = useState<LeaderboardResponse | null>(null);
  const comp = getCompetition(competition);
  const fmt = (v: number) => (comp ? formatScore(comp, v) : String(v));
  const bestLabel = comp?.metric === "accuracy" ? "Лучшая доля верных" : "Лучший MAE";

  useEffect(() => {
    if (!ready) return;
    let active = true;
    fetchLeaderboard(competition).then((res) => {
      if (active) setBoard(res);
    });
    return () => {
      active = false;
    };
  }, [ready, user?.id, username, version, competition]);

  if (!board || (board.ok && !board.enabled)) return null;
  if (!board.ok) {
    return (
      <p className="text-sm text-muted" data-testid="leaderboard-error">
        {board.error}
      </p>
    );
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
              {rows.map((r, i) => (
                <tr
                  key={`${r.place}-${r.login ?? "none"}-${i}`}
                  className={`border-t border-dashed border-line ${r.mine ? "bg-accent-soft/40 font-semibold" : ""}`}
                  data-testid="leaderboard-row"
                  data-mine={r.mine ? "true" : undefined}
                >
                  <td className="py-1.5 pr-3">{r.place}</td>
                  <td className="py-1.5 pr-3 break-all">{r.login ?? <span className="italic text-muted">логин не задан</span>}</td>
                  <td className="py-1.5 pr-3">{fmt(r.score)}</td>
                  <td className="py-1.5">{r.submissions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted">Пока нет результатов — станьте первым.</p>
      )}

      <div className="mt-4 border-t border-dashed border-line-strong pt-3 text-sm">
        {!user ? (
          <p className="text-muted">
            Отправлять решения можно и без аккаунта, но в таблицу лидеров попадают только ученики с аккаунтом — по логину.{" "}
            <Link href="/login" className="text-accent-ink underline">
              Войти
            </Link>
          </p>
        ) : (
          <>
            {me?.place ? (
              <p data-testid="leaderboard-me">
                Ваше место — <b>{me.place}</b> из {board.participants}, {bestLabel.toLowerCase()} — {fmt(me.score ?? 0)}.
              </p>
            ) : (
              <p className="text-muted">После первой отправки здесь появится ваше место.</p>
            )}
            {username === null ? (
              <p className="mt-1.5 text-muted" data-testid="leaderboard-login-hint">
                <Link href="/profile#login" className="text-accent-ink underline">
                  Придумайте логин
                </Link>{" "}
                — пока в таблице вместо него написано «логин не задан».
              </p>
            ) : username ? (
              <p className="mt-1.5 text-xs text-muted" data-testid="leaderboard-login-hint">
                В таблице вы — <b>{username}</b>. Логин можно изменить в{" "}
                <Link href="/profile#login" className="text-accent-ink underline">
                  профиле
                </Link>
                .
              </p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
