"use client";
// Решение соревнования: редактор, запуск в браузере, сбор таблицы submission и отправка на сервер.
// Метрику считает серверная функция по скрытым ответам; здесь — только прогнозы и результат.
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { OutputView, ErrorBox, CodeText } from "../code/OutputView";
import { PyStatus } from "../code/PyStatus";
import { Badge } from "../ui";
import { Leaderboard } from "./Leaderboard";
import { py, stopMessage, type OutputItem, type PyErrorInfo, type RunResult } from "@/lib/py/client";
import { progressStore, useProgressItem, useProgressVersion } from "@/lib/progress/store";
import { competitionKey, countObjects, formatImprovement, formatScore, getCompetition, isBetter, type CompetitionConfig } from "@/lib/competitions/registry";
import { submitPredictions, type SubmissionData, type SubmitResponse } from "@/lib/competitions/client";
import { parseSubmissionCsv } from "@/lib/competitions/csv";
import { useAuth } from "@/lib/auth/AuthProvider";

const CodeEditor = dynamic(() => import("../code/CodeEditor"), { ssr: false });

interface SubmissionRun {
  ok: boolean;
  outputs: OutputItem[];
  error: PyErrorInfo | null;
  message: string;
  submission: SubmissionData | null;
}

/** Отправка в истории на этом устройстве. Старые записи соревнования 1 хранили mae/medianAe вместо score/second. */
interface HistoryEntry {
  at: number;
  score?: number;
  second?: number;
  mae?: number;
  medianAe?: number;
}

const entryScore = (h: HistoryEntry) => (typeof h.score === "number" ? h.score : (h.mae ?? 0));
const entrySecond = (h: HistoryEntry) => (typeof h.second === "number" ? h.second : (h.medianAe ?? 0));
/** Подпись дополнительного числа: медиана ошибки для MAE, число верных для доли верных. */
const secondLabel = (comp: CompetitionConfig) => (comp.metric === "accuracy" ? "Верных" : "Медиана ошибки");

export function CompetitionSubmit({ competition: id, code: starter, html }: { competition: string; code: string; html: string }) {
  const comp = getCompetition(id);
  const key = competitionKey(id);
  const version = useProgressVersion();
  const item = useProgressItem(key);
  const { user } = useAuth();
  const [code, setCode] = useState<string | null>(null);
  const dirty = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState<null | "run" | "submit" | "send">(null);
  const [runRes, setRunRes] = useState<RunResult | null>(null);
  const [subRun, setSubRun] = useState<SubmissionRun | null>(null);
  const [result, setResult] = useState<SubmitResponse | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [boardVersion, setBoardVersion] = useState(0);
  const [upload, setUpload] = useState<{ name: string; error: string | null } | null>(null);

  useEffect(() => {
    if (version === 0) return;
    if (!dirty.current) setCode(typeof item?.code === "string" ? item.code : starter);
  }, [version, item?.code, starter]);

  const saveCode = useCallback(
    (value: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        if (!progressStore.get(key) && value === starter) return;
        progressStore.update(key, (p) => ({ ...p, code: value, codeAt: Date.now(), status: p?.status === "solved" ? "solved" : "in_progress" }));
      }, 600);
    },
    [key, starter]
  );
  useEffect(() => () => void (saveTimer.current && clearTimeout(saveTimer.current)), []);

  if (!comp) return <p className="text-bad">Неизвестное соревнование «{id}».</p>;
  const baseline = comp.baseline.score;
  const fmt = (v: number) => formatScore(comp, v);
  const best = typeof item?.best === "number" ? item.best : null;
  const history = (Array.isArray(item?.history) ? (item.history as HistoryEntry[]) : []).slice(-10).reverse();
  const timeout = comp.timeout;

  function onChange(v: string) {
    dirty.current = true;
    setCode(v);
    saveCode(v);
  }

  async function run() {
    if (busy || code === null) return;
    setBusy("run");
    setSubRun(null);
    setNote(null);
    try {
      py.relieveMemory(); // запуск начинается с чистого пространства имён: перезапуск Python здесь безопасен
      setRunRes(await py.execute<RunResult>({ mode: "run", ns: key, reset: true, setup: "", files: comp!.files, code }, timeout));
    } catch (e) {
      setRunRes(null);
      setNote(stopMessage(e, timeout));
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    if (busy || code === null) return;
    setBusy("submit");
    setRunRes(null);
    setSubRun(null);
    setResult(null);
    setNote(null);
    setUpload(null);
    let collected: SubmissionRun;
    try {
      py.relieveMemory();
      collected = await py.execute<SubmissionRun>(
        {
          mode: "submission",
          ns: key,
          reset: true,
          setup: "",
          files: comp!.files,
          code,
          competition: {
            idColumn: comp!.idColumn,
            predictionColumn: comp!.predictionColumn,
            testFile: comp!.testFile,
            range: comp!.predictionRange,
            idType: comp!.idType,
            predictionType: comp!.predictionType,
            labels: comp!.labels ?? null,
            objectForms: comp!.objectForms,
          },
        },
        timeout
      );
    } catch (e) {
      setNote(stopMessage(e, timeout));
      setBusy(null);
      return;
    }
    setSubRun(collected);
    if (!collected.ok || !collected.submission) {
      setBusy(null);
      return;
    }
    await send(collected.submission, code);
  }

  /** Отправить ответы на сервер и записать результат. solution — код решения (для ответов из файла — null). */
  async function send(submission: SubmissionData, solution: string | null) {
    setBusy("send");
    const res = await submitPredictions(id, submission);
    setResult(res);
    if (res.ok && typeof res.score === "number") {
      const score = res.score;
      const second = res.second ?? 0;
      progressStore.update(key, (p) => {
        const at = Date.now();
        const entry: HistoryEntry = { at, score, second };
        const prevBest = typeof p?.best === "number" ? p.best : null;
        const beat = isBetter(comp!, score, baseline);
        return {
          ...p,
          ...(solution !== null ? { code: solution, codeAt: at } : {}),
          lowerIsBetter: comp!.lowerIsBetter,
          best: prevBest === null ? score : comp!.lowerIsBetter ? Math.min(prevBest, score) : Math.max(prevBest, score),
          lastScore: score,
          submissions: (typeof p?.submissions === "number" ? p.submissions : 0) + 1,
          history: [...(Array.isArray(p?.history) ? (p!.history as HistoryEntry[]) : []), entry].slice(-20),
          status: p?.status === "solved" || beat ? "solved" : "in_progress",
          ...(beat && p?.status !== "solved" ? { solvedAt: at } : {}),
        };
      });
      setBoardVersion((v) => v + 1);
    }
    setBusy(null);
  }

  /** Файл ответов CSV (например, из Colab): разбор формата в браузере, затем та же проверка на сервере. */
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || busy) return;
    setRunRes(null);
    setSubRun(null);
    setResult(null);
    setNote(null);
    if (file.size > 1_000_000) {
      setUpload({ name: file.name, error: "Файл больше 1 МБ — это не похоже на файл ответов." });
      return;
    }
    const parsed = parseSubmissionCsv(await file.text(), comp!);
    if (!parsed.ok) {
      setUpload({ name: file.name, error: parsed.error });
      return;
    }
    setUpload({ name: `${file.name} — ${parsed.rows.toLocaleString("ru-RU")} строк`, error: null });
    await send(parsed.submission, null);
  }

  function reset() {
    if (code !== null && code !== starter && !window.confirm("Вернуть базовое решение? Ваш текущий код будет заменён.")) return;
    dirty.current = true;
    setCode(starter);
    saveCode(starter);
    setRunRes(null);
    setSubRun(null);
    setResult(null);
  }

  const status = item?.status === "solved" ? "solved" : item?.status === "in_progress" ? "in_progress" : "not_started";
  const errorLine = (subRun?.error?.where === "<ваш код>" ? subRun.error.line : null) ?? (runRes?.error?.where === "<ваш код>" ? runRes.error.line : null) ?? null;

  return (
    <div className="not-prose my-6 space-y-6">
      <section className="paper overflow-hidden" data-testid="competition-submit" data-competition={id} data-status={status}>
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-dashed border-line-strong bg-soft/50 px-4 py-2.5 sm:px-5">
          <span className="font-display text-[1.05rem] font-semibold text-warm-ink">Ваше решение</span>
          <Badge tone="accent">соревнование</Badge>
          <span className="ml-auto text-sm text-muted" data-testid="competition-best">
            {best === null ? (
              <>baseline: {fmt(baseline)}</>
            ) : (
              <>
                лучший результат: <b className={isBetter(comp, best, baseline) ? "text-ok" : "text-ink"}>{fmt(best)}</b> · baseline {fmt(baseline)}
              </>
            )}
          </span>
        </header>
        <div className="p-4 sm:p-5">
          <p className="text-sm text-muted">
            Код выполняется в вашем браузере. В конце он должен создать таблицу <code>submission</code> с колонками <code>{comp.idColumn}</code> и{" "}
            <code>{comp.predictionColumn}</code> — по строке на каждую {comp.objectAcc} проверочной таблицы. Ответы отправляются на сервер, и он считает {comp.metricLabelAcc}{" "}
            по скрытым {comp.hiddenWhat}. Засчитывается {comp.dailyLimit} отправок за 24 часа.
          </p>
          <div className="mt-3 overflow-hidden rounded-[4px] border border-line-strong">
            {code === null ? (
              <pre className="code-block !rounded-none !border-0" dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <CodeEditor value={code} onChange={onChange} onRun={run} ariaLabel="Решение соревнования" errorLine={errorLine} maxHeight={640} />
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {busy ? (
              <button type="button" onClick={() => py.stop()} disabled={busy === "send"} className="rounded-md border border-line-strong px-3.5 py-2 text-sm font-semibold hover:bg-soft disabled:opacity-60" data-testid="stop">
                {busy === "send" ? "Сервер считает метрику…" : "■ Стоп"}
              </button>
            ) : (
              <>
                <button type="button" onClick={submit} className="rounded-md bg-ok px-4 py-2 text-sm font-semibold text-white shadow-[var(--shadow)] hover:brightness-110 dark:text-[#0e1a13]" data-testid="competition-send">
                  ⬆ Отправить на проверку
                </button>
                <button type="button" onClick={run} className="rounded-md border border-line-strong px-3.5 py-2 text-sm font-semibold hover:border-accent" data-testid="run" title="Ctrl/Cmd+Enter">
                  ▶ Выполнить
                </button>
              </>
            )}
            <button type="button" onClick={reset} className="rounded-md px-3 py-2 text-sm text-muted hover:bg-soft hover:text-ink" data-testid="reset">
              ↺ Вернуть baseline
            </button>
          </div>

          {comp.upload && (
            <div className="mt-4 rounded-md border border-dashed border-line-strong px-3 py-3 text-sm" data-testid="competition-upload">
              <p className="text-ink">
                <b>Решали в Colab?</b> Загрузите файл ответов CSV с колонками <code>{comp.idColumn}</code> и <code>{comp.predictionColumn}</code> — по строке на каждый{" "}
                {comp.objectAcc}. Сервер проверит его так же, как ответы из кода, и это тоже отправка.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className={`inline-flex items-center gap-2 rounded-md border border-line-strong px-3.5 py-2 font-semibold ${busy ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-accent"}`}>
                  ⬆ Загрузить CSV
                  <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={onFile} disabled={Boolean(busy)} data-testid="competition-file" />
                </label>
                {upload && !upload.error && (
                  <span className="text-muted" data-testid="competition-file-name">
                    {upload.name}
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="mt-3 space-y-3" aria-live="polite">
            {busy && busy !== "send" && <PyStatus />}
            {note && (
              <p className="rounded-md border border-warn/50 bg-warn-soft px-3 py-2 text-sm text-ink" role="alert" data-testid="run-note">
                {note}
              </p>
            )}
            {subRun && !subRun.ok && (
              <div className="rounded-md border-l-4 border-bad bg-bad-soft px-3 py-2.5 text-sm" data-testid="competition-error">
                <p className="font-display font-semibold text-bad">Прогнозы не отправлены</p>
                <p className="mt-0.5 text-ink">
                  <CodeText text={subRun.message} />
                </p>
              </div>
            )}
            {subRun?.error && <ErrorBox error={subRun.error} />}
            {upload?.error && (
              <div className="rounded-md border-l-4 border-bad bg-bad-soft px-3 py-2.5 text-sm" data-testid="competition-error">
                <p className="font-display font-semibold text-bad">Файл «{upload.name}» не отправлен</p>
                <p className="mt-0.5 text-ink">{upload.error}</p>
              </div>
            )}
            {result && !result.ok && (
              <div className="rounded-md border-l-4 border-bad bg-bad-soft px-3 py-2.5 text-sm" data-testid="competition-error">
                <p className="font-display font-semibold text-bad">Сервер не принял прогнозы</p>
                <p className="mt-0.5 text-ink">{result.error}</p>
              </div>
            )}
            {result?.ok && typeof result.score === "number" && <ResultCard comp={comp} res={result} signedIn={Boolean(user)} />}
            {subRun && subRun.outputs.length > 0 && (
              <div className="nb-cell">
                <div className="nb-prompt out">Out:</div>
                <div className="min-w-0 py-1">
                  <OutputView outputs={subRun.outputs} />
                </div>
              </div>
            )}
            {runRes && (
              <div className="nb-cell" data-testid="run-output">
                <div className="nb-prompt out">Out:</div>
                <div className="min-w-0 py-1">
                  <OutputView outputs={runRes.outputs} error={runRes.error} />
                  {runRes.ok && !runRes.outputs.length && <p className="text-xs italic text-muted">выполнено без ошибок, вывода нет</p>}
                </div>
              </div>
            )}
          </div>

          {history.length > 0 && (
            <details className="mt-5 rounded-md border border-dashed border-line-strong text-sm" data-testid="competition-history">
              <summary className="cursor-pointer select-none px-3 py-2 text-muted">Ваши отправки на этом устройстве ({history.length})</summary>
              <div className="overflow-x-auto border-t border-dashed border-line-strong px-3 py-2">
                <table className="w-full text-left tabular-nums">
                  <thead className="text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="py-1 pr-3 font-semibold">Когда</th>
                      <th className="py-1 pr-3 font-semibold">{comp.metricLabel}</th>
                      <th className="py-1 font-semibold">{secondLabel(comp)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.at} className="border-t border-dashed border-line">
                        <td className="py-1 pr-3">{new Date(h.at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}</td>
                        <td className={`py-1 pr-3 font-semibold ${isBetter(comp, entryScore(h), baseline) ? "text-ok" : ""}`}>{fmt(entryScore(h))}</td>
                        <td className="py-1">{comp.metric === "accuracy" ? entrySecond(h).toLocaleString("ru-RU") : fmt(entrySecond(h))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </div>
      </section>
      <Leaderboard competition={id} version={boardVersion} />
    </div>
  );
}

function ResultCard({ comp, res, signedIn }: { comp: CompetitionConfig; res: SubmitResponse; signedIn: boolean }) {
  const score = res.score!;
  const baseline = comp.baseline.score;
  const fmt = (v: number) => formatScore(comp, v);
  const better = isBetter(comp, score, baseline);
  const imp = res.improvement ?? 0;
  const accuracy = comp.metric === "accuracy";
  return (
    <div
      className={`rounded-md border-l-4 px-3 py-3 text-sm ${better ? "border-ok bg-ok-soft" : "border-warn bg-warn-soft"}`}
      data-testid="competition-result"
      data-score={score}
      {...(accuracy ? { "data-correct": res.correct } : { "data-mae": score })}
    >
      <p className="font-display text-base font-semibold">
        {res.n ? `Проверено ${countObjects(comp, res.n)}. ` : ""}
        {accuracy ? "Доля верных" : "MAE"} = <span data-testid="competition-score">{fmt(score)}</span>
        {accuracy && typeof res.correct === "number" && res.n ? ` (${res.correct.toLocaleString("ru-RU")} из ${res.n.toLocaleString("ru-RU")})` : ""}
      </p>
      <p className="mt-1 text-ink">
        {imp === 0 ? "Ровно как у baseline" : better ? `Лучше baseline (${fmt(baseline)}) на ${formatImprovement(comp, imp)}` : `Хуже baseline (${fmt(baseline)}) на ${formatImprovement(comp, imp)}`}
        {!accuracy && typeof res.medianAe === "number" && <> · у половины машин ошибка меньше {fmt(res.medianAe)}</>}
      </p>
      {res.leaderboard && (
        <p className="mt-1 text-ink">
          Ваш лучший результат — {fmt(res.leaderboard.best)}, место {res.leaderboard.place} из {res.leaderboard.participants}.
        </p>
      )}
      {res.leaderboardError && <p className="mt-1 text-warn">{res.leaderboardError}</p>}
      <p className="mt-1 text-xs text-muted">
        Осталось отправок за 24 часа: {res.remaining}.{" "}
        {res.countedAs === "guest" && (res.leaderboardEnabled ? (signedIn ? "" : "Войдите в аккаунт, чтобы результат попал в таблицу лидеров.") : "")}
      </p>
    </div>
  );
}
