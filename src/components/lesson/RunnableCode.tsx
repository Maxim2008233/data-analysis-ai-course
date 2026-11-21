"use client";
// Запускаемый пример в теории — ячейка «как в тетради»: In [n] — код, Out [n] — результат.
import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLessonRun } from "./LessonRun";
import { OutputView } from "../code/OutputView";
import { PyStatus } from "../code/PyStatus";
import { py, type RunResult } from "@/lib/py/client";

const CodeEditor = dynamic(() => import("../code/CodeEditor"), { ssr: false });
const noopSubscribe = () => () => {};

export function RunnableCode({ code, index, html }: { code: string; index: string | number; html: string }) {
  const idx = Number(index);
  const run = useLessonRun();
  const [value, setValue] = useState(code);
  const valueRef = useRef(code);
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [runCount, setRunCount] = useState(0);
  const [state, setState] = useState<{ running: boolean; result?: RunResult | null; note?: string | null; ms?: number | null }>({ running: false });

  useEffect(() => {
    if (!run) return;
    return run.register(idx, {
      getCode: () => valueRef.current,
      setResult: (r) => {
        setState(r);
        if (!r.running && r.result) setRunCount((c) => c + 1);
      },
    });
  }, [run, idx]);

  const onChange = (v: string) => {
    valueRef.current = v;
    setValue(v);
  };
  const doRun = () => {
    if (state.running) return;
    void run?.runExample(idx);
  };
  const reset = () => {
    valueRef.current = code;
    setValue(code);
  };
  const label = state.running ? "*" : runCount ? String(runCount) : " ";

  return (
    <div className="not-prose my-6" data-testid="runnable-example">
      <div className="nb-cell">
        <div className="nb-prompt">In [{label}]:</div>
        <div className="min-w-0 overflow-hidden rounded-[4px] border border-line bg-code shadow-[var(--shadow)]">
          {mounted ? (
            <CodeEditor
              value={value}
              onChange={onChange}
              onRun={doRun}
              ariaLabel={`Код примера ${idx + 1}`}
              errorLine={state.result?.error?.where === "<ваш код>" ? state.result?.error?.line ?? null : null}
            />
          ) : (
            <pre className="code-block !rounded-none !border-0 !border-l-0" dangerouslySetInnerHTML={{ __html: html }} />
          )}
          <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-line px-2.5 py-1.5">
            <span className="text-xs text-muted">Пример {idx + 1} · можно менять и запускать снова</span>
            <div className="ml-auto flex items-center gap-1.5">
              {value !== code && (
                <button type="button" onClick={reset} className="rounded px-2 py-1 text-xs text-muted hover:bg-soft hover:text-ink" title="Вернуть исходный код примера">
                  ↺ исходный код
                </button>
              )}
              {state.running ? (
                <button type="button" onClick={() => py.stop()} className="rounded border border-line-strong px-2.5 py-1 text-xs font-semibold hover:bg-soft">
                  ■ Стоп
                </button>
              ) : (
                <button
                  type="button"
                  onClick={doRun}
                  className="rounded bg-accent px-3 py-1 text-xs font-semibold text-[var(--bg-elev)] dark:text-[#0c1422]"
                  data-testid="run-example"
                  title="Запустить (Ctrl/Cmd+Enter)"
                >
                  ▶ Выполнить
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      {(state.running || state.result || state.note) && (
        <div className="nb-cell mt-1">
          <div className="nb-prompt out">{state.result ? `Out[${label}]:` : ""}</div>
          <div className="min-w-0 py-1.5 pl-1">
            {state.running && <PyStatus />}
            {state.note && <p className="mb-2 text-xs italic text-muted">{state.note}</p>}
            {state.result && <OutputView outputs={state.result.outputs} error={state.result.error} />}
            {state.result && state.result.ok && !state.result.outputs.length && !state.running && <p className="text-xs italic text-muted">выполнено, вывода нет</p>}
          </div>
        </div>
      )}
    </div>
  );
}
