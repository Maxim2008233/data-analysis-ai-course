"use client";
// Задание: условие, «Вспомним», подготовка, редактор, запуск, проверка, подсказки по уровням, решение.
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { OutputView, ErrorBox, CodeText } from "../code/OutputView";
import { PyStatus } from "../code/PyStatus";
import { QuizQuestions } from "./Quiz";
import { Badge, DIFFICULTY_LABEL, KIND_LABEL } from "../ui";
import { py, stopMessage, type CheckResult, type RunResult } from "@/lib/py/client";
import { progressStore, useProgressItem, useProgressVersion } from "@/lib/progress/store";
import { taskKey } from "@/lib/progress/stats";
import { ATTEMPTS_BEFORE_SOLUTION, CHECK_TIMEOUT_S, RUN_TIMEOUT_S } from "@/lib/config";
import type { QuizQuestionView } from "@/lib/content/markdown";
import type { Difficulty, TaskKind } from "@/lib/content/types";

const CodeEditor = dynamic(() => import("../code/CodeEditor"), { ssr: false });

export interface ClientTask {
  id: string;
  number: string;
  title: string;
  kind: TaskKind;
  difficulty: Difficulty;
  prelude?: string;
  starter?: string;
  solution?: string;
  tests?: string;
  files: string[];
  timeout?: number;
  quiz?: QuizQuestionView[];
  hintCount: number;
}

interface Props {
  task: ClientTask;
  statement: ReactNode;
  hints: ReactNode[];
  explanation?: ReactNode;
  recall?: ReactNode;
  preludeNote?: ReactNode;
  preludeHtml?: string;
  solutionHtml?: string;
  starterHtml?: string;
}

type Busy = null | "run" | "check";

export function TaskCard({ task, statement, hints, explanation, recall, preludeNote, preludeHtml, solutionHtml, starterHtml }: Props) {
  const key = taskKey(task.id);
  const version = useProgressVersion();
  const item = useProgressItem(key);
  const starter = task.starter ?? "";
  const [code, setCode] = useState<string | null>(null);
  const dirty = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [runRes, setRunRes] = useState<RunResult | null>(null);
  const [checkRes, setCheckRes] = useState<CheckResult | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // восстановить сохранённый код, когда хранилище прогресса готово (и при обновлении с другого устройства)
  useEffect(() => {
    if (version === 0) return;
    if (!dirty.current) setCode(item?.code ?? starter);
  }, [version, item?.code, starter]);

  const status = item?.status ?? "not_started";
  const hintsOpen = item?.hints ?? 0;
  const fails = item?.fails ?? 0;
  const solutionShown = Boolean(item?.solutionShown);
  const canShowSolution = hintsOpen >= task.hintCount || fails >= ATTEMPTS_BEFORE_SOLUTION || status === "solved";
  const timeout = task.timeout ?? CHECK_TIMEOUT_S;

  const saveCode = useCallback(
    (value: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const prev = progressStore.get(key);
        if (!prev && value === starter) return;
        progressStore.update(key, (p) => ({
          ...p,
          code: value,
          codeAt: Date.now(),
          status: p?.status === "solved" ? "solved" : "in_progress",
        }));
      }, 600);
    },
    [key, starter]
  );

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    []
  );

  function onChange(v: string) {
    dirty.current = true;
    setCode(v);
    saveCode(v);
  }

  function flushSave(value: string) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const prev = progressStore.get(key);
    if (!prev && value === starter) return;
    if (prev?.code === value) return;
    progressStore.update(key, (p) => ({ ...p, code: value, codeAt: Date.now(), status: p?.status === "solved" ? "solved" : "in_progress" }));
  }

  async function run() {
    if (busy || code === null) return;
    flushSave(code);
    setBusy("run");
    setCheckRes(null);
    setNote(null);
    try {
      py.relieveMemory(); // у задания своё свежее пространство имён: перезапуск Python здесь безопасен
      const res = await py.execute<RunResult>(
        { mode: "run", ns: `task:${task.id}`, reset: true, setup: task.prelude ?? "", files: task.files, code },
        Math.max(RUN_TIMEOUT_S, task.timeout ?? 0)
      );
      setRunRes(res);
    } catch (e) {
      setRunRes(null);
      setNote(stopMessage(e, Math.max(RUN_TIMEOUT_S, task.timeout ?? 0)));
    } finally {
      setBusy(null);
    }
  }

  async function check() {
    if (busy || code === null) return;
    flushSave(code);
    setBusy("check");
    setRunRes(null);
    setNote(null);
    try {
      py.relieveMemory();
      const res = await py.execute<CheckResult>(
        { mode: "check", prelude: task.prelude ?? "", code, solution: task.solution ?? "", tests: task.tests ?? "", files: task.files },
        timeout
      );
      setCheckRes(res);
      if (res.kind !== "internal") {
        progressStore.update(key, (p) => ({
          ...p,
          attempts: (p?.attempts ?? 0) + 1,
          fails: (p?.fails ?? 0) + (res.passed ? 0 : 1),
          status: res.passed ? "solved" : p?.status === "solved" ? "solved" : "in_progress",
          ...(res.passed ? { solvedAt: Date.now() } : {}),
          code,
          codeAt: Date.now(),
        }));
      }
    } catch (e) {
      setCheckRes(null);
      setNote(stopMessage(e, timeout));
      progressStore.update(key, (p) => ({ ...p, attempts: (p?.attempts ?? 0) + 1, fails: (p?.fails ?? 0) + 1, status: p?.status === "solved" ? "solved" : "in_progress" }));
    } finally {
      setBusy(null);
    }
  }

  function reset() {
    if (code !== null && code !== starter && !window.confirm("Вернуть исходный код задания? Ваш текущий код будет заменён.")) return;
    dirty.current = true;
    setCode(starter);
    setRunRes(null);
    setCheckRes(null);
    setNote(null);
    progressStore.update(key, (p) => ({ ...p, code: starter, codeAt: Date.now(), status: p?.status === "solved" ? "solved" : p?.status ?? "not_started" }));
  }

  function openHint(level: number) {
    progressStore.update(key, (p) => ({ ...p, hints: Math.max(p?.hints ?? 0, level), status: p?.status === "solved" ? "solved" : "in_progress" }));
  }

  function showSolution() {
    progressStore.update(key, (p) => ({ ...p, solutionShown: true }));
  }

  function insertSolution() {
    if (!task.solution) return;
    if (code !== null && code !== starter && !window.confirm("Заменить ваш код эталонным решением?")) return;
    dirty.current = true;
    setCode(task.solution);
    saveCode(task.solution);
  }

  async function copySolution() {
    try {
      await navigator.clipboard.writeText(task.solution ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* нет доступа к буферу */
    }
  }

  const statusStamp =
    status === "solved" ? (
      <span className="stamp text-ok">✓ Решено</span>
    ) : status === "in_progress" ? (
      <span className="stamp text-warm" style={{ transform: "rotate(2deg)" }}>
        В работе
      </span>
    ) : (
      <span className="text-xs italic text-muted">не начато</span>
    );

  const isQuiz = task.kind === "quiz" || task.kind === "predict";
  const errorLine =
    (checkRes?.error?.where === "<ваш код>" ? checkRes.error.line : null) ?? (runRes?.error?.where === "<ваш код>" ? runRes.error.line : null) ?? null;

  return (
    <section id={task.id} className="paper scroll-mt-20 overflow-hidden" data-testid="task-card" data-task-id={task.id} data-status={status}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-dashed border-line-strong bg-soft/50 px-4 py-2.5 sm:px-5">
        <span className="font-display text-[1.05rem] font-semibold text-warm-ink">Задание {task.number}</span>
        <Badge tone={task.difficulty === "star" ? "warm" : task.difficulty === "warmup" ? "info" : "neutral"}>{DIFFICULTY_LABEL[task.difficulty]}</Badge>
        {task.kind !== "code" && <Badge tone="accent">{KIND_LABEL[task.kind]}</Badge>}
        <span className="ml-auto" data-testid="task-status">
          {statusStamp}
        </span>
      </header>
      <div className="p-4 sm:p-5">
        <h3 className="mb-2 font-display text-xl font-semibold leading-snug">{task.title}</h3>
        <div className="md text-[0.98rem] leading-relaxed">{statement}</div>

        {recall && <div className="mt-4">{recall}</div>}

        {isQuiz && task.quiz ? (
          <div className="mt-5">
            <QuizQuestions
              questions={task.quiz}
              saved={item?.quiz}
              revealAll={solutionShown}
              testId="task-quiz"
              onSubmit={(answers) => {
                const allOk = Object.values(answers).every((a) => a.correct);
                progressStore.update(key, (p) => ({
                  ...p,
                  quiz: { ...(p?.quiz ?? {}), ...answers },
                  attempts: (p?.attempts ?? 0) + 1,
                  fails: (p?.fails ?? 0) + (allOk ? 0 : 1),
                  status: allOk ? "solved" : p?.status === "solved" ? "solved" : "in_progress",
                  ...(allOk ? { solvedAt: Date.now() } : {}),
                }));
              }}
            />
          </div>
        ) : (
          <>
            {task.prelude && preludeHtml && (
              <details className="mt-4 rounded-md border border-dashed border-line-strong text-sm" data-testid="task-prelude">
                <summary className="cursor-pointer select-none px-3 py-2 text-muted">
                  <span className="font-medium">Подготовка</span> — уже выполнена перед вашим кодом
                </summary>
                <div className="border-t border-dashed border-line-strong px-3 py-2">
                  {preludeNote && <div className="md mb-2 text-xs text-muted">{preludeNote}</div>}
                  <pre className="code-block" dangerouslySetInnerHTML={{ __html: preludeHtml }} />
                </div>
              </details>
            )}
            <p className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wider text-muted">Ваш код</p>
            <div className="overflow-hidden rounded-[4px] border border-line-strong">
              {code === null ? (
                <pre className="code-block !rounded-none !border-0" dangerouslySetInnerHTML={{ __html: starterHtml ?? "" }} />
              ) : (
                <CodeEditor value={code} onChange={onChange} onRun={run} ariaLabel={`Код задания ${task.number}`} errorLine={errorLine} />
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {busy ? (
                <button type="button" onClick={() => py.stop()} className="rounded-md border border-line-strong px-3.5 py-2 text-sm font-semibold hover:bg-soft" data-testid="stop">
                  ■ Стоп
                </button>
              ) : (
                <>
                  <button type="button" onClick={check} className="rounded-md bg-ok px-4 py-2 text-sm font-semibold text-white shadow-[var(--shadow)] hover:brightness-110 dark:text-[#0e1a13]" data-testid="check">
                    ✓ Проверить
                  </button>
                  <button type="button" onClick={run} className="rounded-md border border-line-strong px-3.5 py-2 text-sm font-semibold hover:border-accent" data-testid="run" title="Ctrl/Cmd+Enter">
                    ▶ Выполнить
                  </button>
                </>
              )}
              <button type="button" onClick={reset} className="rounded-md px-3 py-2 text-sm text-muted hover:bg-soft hover:text-ink" data-testid="reset">
                ↺ Сбросить к исходному
              </button>
              <span className="ml-auto hidden text-xs text-muted sm:inline">Ctrl/Cmd+Enter — выполнить</span>
            </div>

            <div className="mt-3 space-y-3" aria-live="polite">
              {busy && <PyStatus />}
              {note && (
                <p className="rounded-md border border-warn/50 bg-warn-soft px-3 py-2 text-sm text-ink" role="alert" data-testid="run-note">
                  {note}
                </p>
              )}
              {checkRes && (
                <div
                  className={`rounded-md border-l-4 px-3 py-2.5 text-sm ${checkRes.passed ? "border-ok bg-ok-soft" : checkRes.kind === "internal" ? "border-warn bg-warn-soft" : "border-bad bg-bad-soft"}`}
                  data-testid="check-result"
                  data-passed={checkRes.passed ? "true" : "false"}
                >
                  <p className={`font-display font-semibold ${checkRes.passed ? "text-ok" : checkRes.kind === "internal" ? "text-warn" : "text-bad"}`}>
                    {checkRes.passed ? "Решено — все проверки пройдены" : checkRes.kind === "error" ? "Ошибка при выполнении" : "Пока не получилось"}
                  </p>
                  {!checkRes.passed && (
                    <p className="mt-0.5 text-ink">
                      <CodeText text={checkRes.message} />
                    </p>
                  )}
                </div>
              )}
              {checkRes?.error && <ErrorBox error={checkRes.error} />}
              {checkRes && checkRes.outputs.length > 0 && (
                <div className="nb-cell">
                  <div className="nb-prompt out">Out:</div>
                  <div className="min-w-0 py-1">
                    <OutputView outputs={checkRes.outputs} />
                  </div>
                </div>
              )}
              {runRes && (
                <div className="nb-cell" data-testid="run-output">
                  <div className="nb-prompt out">Out:</div>
                  <div className="min-w-0 py-1">
                    <OutputView outputs={runRes.outputs} error={runRes.error} />
                    {runRes.ok && !runRes.outputs.length && <p className="text-xs italic text-muted">выполнено без ошибок, вывода нет — нажмите «Проверить», чтобы запустить тесты</p>}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Подсказки-стикеры и решение */}
        <div className="mt-5 border-t border-dashed border-line-strong pt-4" data-testid="hints">
          {hintsOpen > 0 && (
            <div className="mb-3 grid gap-3 sm:grid-cols-2">
              {hints.slice(0, hintsOpen).map((h, i) => (
                <div
                  key={i}
                  className="rounded-[3px] border border-note-line bg-note px-3 py-2.5 text-sm shadow-[var(--shadow)]"
                  style={{ transform: `rotate(${i % 2 === 0 ? -0.6 : 0.5}deg)` }}
                  data-testid="hint"
                >
                  <p className="font-display text-xs font-semibold italic text-warm-ink">Подсказка {i + 1}</p>
                  <div className="md mt-0.5 text-ink">{h}</div>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {hintsOpen < hints.length && (
              <button type="button" onClick={() => openHint(hintsOpen + 1)} className="rounded-md border border-note-line bg-note/70 px-3 py-1.5 text-sm hover:bg-note" data-testid="open-hint">
                Подсказка {hintsOpen + 1} из {hints.length}
              </button>
            )}
            {canShowSolution && !solutionShown && (
              <button type="button" onClick={showSolution} className="rounded-md border border-line-strong px-3 py-1.5 text-sm hover:border-accent" data-testid="show-solution">
                Показать решение
              </button>
            )}
            {!canShowSolution && !solutionShown && (
              <span className="text-xs italic text-muted" data-testid="solution-locked">
                Решение откроется после всех подсказок или {ATTEMPTS_BEFORE_SOLUTION} неудачных проверок.
              </span>
            )}
          </div>
          {solutionShown && (
            <div className="mt-4 rounded-md border-2 border-dashed border-accent/50 p-3" data-testid="solution">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <p className="font-display font-semibold text-accent-ink">Эталонное решение</p>
                {!isQuiz && task.solution && (
                  <div className="ml-auto flex gap-2">
                    <button type="button" onClick={copySolution} className="rounded px-2 py-1 text-xs text-muted hover:bg-soft hover:text-ink">
                      {copied ? "Скопировано" : "Копировать"}
                    </button>
                    <button type="button" onClick={insertSolution} className="rounded px-2 py-1 text-xs text-muted hover:bg-soft hover:text-ink">
                      Вставить в редактор
                    </button>
                  </div>
                )}
              </div>
              {!isQuiz && solutionHtml && <pre className="code-block" dangerouslySetInnerHTML={{ __html: solutionHtml }} />}
              {explanation && <div className="md mt-2 text-sm">{explanation}</div>}
              <p className="mt-2 text-xs italic text-muted">Разберитесь в решении и напишите его сами — так тема запомнится лучше.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
