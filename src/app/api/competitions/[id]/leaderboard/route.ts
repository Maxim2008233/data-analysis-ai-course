// Таблица лидеров соревнования: логины учеников с аккаунтом и их лучшие результаты (без идентификаторов пользователей).
import { fromStoredLoss, getCompetition } from "@/lib/competitions/registry";
import { getLeaderboard, leaderboardEnabled, userFromRequest } from "@/lib/competitions/server";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const comp = getCompetition(id);
  if (!comp) return json({ ok: false, error: "Такого соревнования нет." }, 404);
  if (!leaderboardEnabled) return json({ ok: true, enabled: false });
  try {
    const user = await userFromRequest(req);
    const board = await getLeaderboard(id, user?.id ?? null);
    if (!board) return json({ ok: true, enabled: false });
    // в базе хранится величина «меньше — лучше»; ученику показываем саму метрику
    return json({
      ok: true,
      enabled: true,
      participants: board.participants,
      rows: board.rows.map(({ loss, ...r }) => ({ ...r, score: fromStoredLoss(comp, loss) })),
      me: board.me && { login: board.me.login, submissions: board.me.submissions, place: board.me.place, score: board.me.loss === null ? null : fromStoredLoss(comp, board.me.loss) },
    });
  } catch {
    return json({ ok: false, error: "Таблица лидеров временно недоступна." }, 503);
  }
}
