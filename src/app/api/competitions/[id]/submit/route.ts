// Проверка прогнозов соревнования на скрытых ответах. Ответы есть только здесь, на сервере.
// Порядок: проверка формата → лимит отправок → метрика → (для аккаунта) запись в таблицу лидеров.
import { fromStoredLoss, getCompetition, improvementOver, toStoredLoss } from "@/lib/competitions/registry";
import { scoreAccuracy, scoreChoices, scorePredictions, validateChoices, validateLabels, validateSubmission } from "@/lib/competitions/scoring";
import { formatWait, limitState, memoryLimiter, WINDOW_MS, type LimitState } from "@/lib/competitions/limits";
import { clientIp, getAnswers, leaderboardEnabled, recentSubmissionTimes, recordSubmission, userFromRequest, type RecordedResult } from "@/lib/competitions/server";

export const dynamic = "force-dynamic";

const MAX_BODY = 1_000_000;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const comp = getCompetition(id);
  const answers = getAnswers(id);
  if (!comp || !answers) return json({ ok: false, error: "Такого соревнования нет." }, 404);

  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return json({ ok: false, error: "Слишком большой запрос." }, 413);
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) return json({ ok: false, error: "Слишком большой запрос." }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ ok: false, error: "Не удалось прочитать прогнозы: сервер ждёт JSON с массивами ids и predictions." }, 400);
  }

  // формат и метрика: MAE по ценам, доля верных классов или доля верных номеров вариантов
  let score: number;
  let second: number;
  let n: number;
  let extra: Record<string, number>;
  if (answers.kind === "classes") {
    const checked = validateLabels(body, answers.ids, comp.labels ?? []);
    if (!checked.ok) return json({ ok: false, error: checked.error }, 400);
    const s = scoreAccuracy(answers.classes, checked.labels);
    score = Math.round(s.accuracy * 1e4) / 1e4;
    second = s.correct;
    n = s.n;
    extra = { accuracy: score, correct: s.correct };
  } else if (answers.kind === "choices") {
    const checked = validateChoices(body, answers.ids);
    if (!checked.ok) return json({ ok: false, error: checked.error }, 400);
    const s = scoreChoices(answers.ids, checked.predictions, answers.scored, answers.answers);
    score = Math.round(s.accuracy * 1e4) / 1e4;
    second = s.correct;
    n = s.n;
    extra = { accuracy: score, correct: s.correct };
  } else {
    const checked = validateSubmission(body, answers.ids, comp.predictionRange);
    if (!checked.ok) return json({ ok: false, error: checked.error }, 400);
    const s = scorePredictions(answers.prices, checked.predictions);
    score = Math.round(s.mae);
    second = Math.round(s.medianAe);
    n = s.n;
    extra = { mae: score, medianAe: second };
  }

  // лимит отправок: для аккаунта — по журналу в базе, иначе — в памяти функции (по пользователю или IP)
  const user = await userFromRequest(req);
  const now = Date.now();
  const memKey = `${id}:${user ? `user:${user.id}` : `ip:${clientIp(req)}`}`;
  let state: LimitState;
  let useDb = Boolean(user && leaderboardEnabled);
  if (useDb) {
    try {
      const times = await recentSubmissionTimes(id, user!.id, now - WINDOW_MS);
      state = limitState(times ?? [], comp.dailyLimit, now);
    } catch {
      useDb = false;
      state = memoryLimiter.state(memKey, comp.dailyLimit, now);
    }
  } else {
    state = memoryLimiter.state(memKey, comp.dailyLimit, now);
  }
  if (state.remaining <= 0) {
    return json(
      {
        ok: false,
        error: `Лимит — ${comp.dailyLimit} отправок за 24 часа. Следующая станет доступна через ${formatWait(state.retryAfterMs)}. Пока проверяйте идеи на своей validation.`,
        limit: comp.dailyLimit,
        remaining: 0,
        retryAfterMs: state.retryAfterMs,
      },
      429
    );
  }

  let recorded: RecordedResult | null = null;
  let leaderboardError: string | null = null;
  if (useDb) {
    try {
      recorded = await recordSubmission(id, user!.id, toStoredLoss(comp, score), second);
    } catch {
      leaderboardError = "Результат посчитан, но не записан в таблицу лидеров: база недоступна. Попробуйте позже.";
      memoryLimiter.record(memKey, now);
    }
  } else {
    memoryLimiter.record(memKey, now);
  }

  return json({
    ok: true,
    metric: comp.metric,
    score,
    second,
    ...extra,
    n,
    baseline: comp.baseline,
    improvement: Math.round(10 * improvementOver(comp, score)) / 10,
    limit: comp.dailyLimit,
    remaining: state.remaining - 1,
    countedAs: user ? "account" : "guest",
    leaderboard: recorded && {
      best: fromStoredLoss(comp, recorded.bestLoss),
      bestSecond: recorded.bestSecond,
      submissions: recorded.submissions,
      place: recorded.place,
      participants: recorded.participants,
    },
    leaderboardEnabled,
    leaderboardError,
  });
}
