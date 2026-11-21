// Имя ученика в таблице лидеров (необязательно): без имени результат учитывается в местах, но не показывается.
import { getCompetition } from "@/lib/competitions/registry";
import { leaderboardEnabled, normalizeNickname, setNickname, userFromRequest } from "@/lib/competitions/server";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getCompetition(id)) return json({ ok: false, error: "Такого соревнования нет." }, 404);
  if (!leaderboardEnabled) return json({ ok: false, error: "Таблица лидеров не настроена на этом сайте." }, 404);
  const user = await userFromRequest(req);
  if (!user) return json({ ok: false, error: "Войдите в аккаунт, чтобы указать имя в таблице лидеров." }, 401);
  let body: { nickname?: unknown };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return json({ ok: false, error: "Ожидается JSON: { \"nickname\": \"…\" }." }, 400);
  }
  const norm = normalizeNickname(body?.nickname ?? null);
  if (!norm.ok) return json({ ok: false, error: norm.error }, 400);
  try {
    const res = await setNickname(id, user.id, norm.nickname);
    if (!res.ok) return json({ ok: false, error: res.error }, 409);
    return json({ ok: true, nickname: norm.nickname });
  } catch {
    return json({ ok: false, error: "Не удалось сохранить имя: база недоступна." }, 503);
  }
}
