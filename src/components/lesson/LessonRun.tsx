"use client";
// Общее пространство имён для примеров урока (как в ноутбуке): пример N видит переменные примеров 1…N-1.
// Если ученик запускает пример, не запустив предыдущие, они выполняются автоматически.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { py, stopMessage, type RunResult } from "@/lib/py/client";
import { RUN_TIMEOUT_S } from "@/lib/config";

interface ExampleHandle {
  getCode: () => string;
  setResult: (r: { running: boolean; result?: RunResult | null; note?: string | null; ms?: number | null }) => void;
}

interface LessonRunApi {
  register: (index: number, h: ExampleHandle) => () => void;
  runExample: (index: number) => Promise<void>;
  resetLesson: () => void;
}

const Ctx = createContext<LessonRunApi | null>(null);

export function LessonRunProvider({ lessonId, setup, files, children }: { lessonId: string; setup: string; files: string[]; children: ReactNode }) {
  const handles = useRef(new Map<number, ExampleHandle>());
  const ranGen = useRef(new Map<number, number>());
  const nsKey = `lesson:${lessonId}`;

  useEffect(() => {
    // заранее готовим Python, пока ученик читает теорию
    const t = setTimeout(() => py.preload(), 1500);
    return () => clearTimeout(t);
  }, []);

  const execOne = useCallback(
    async (index: number, silentNote?: string): Promise<boolean> => {
      const h = handles.current.get(index);
      if (!h) return true;
      h.setResult({ running: true, note: silentNote ?? null });
      const t0 = performance.now();
      try {
        py.preload();
        const gen = py.state.generation;
        const res = await py.execute<RunResult>(
          { mode: "run", ns: nsKey, setup, files, code: h.getCode(), reset: !Array.from(ranGen.current.values()).includes(gen) },
          RUN_TIMEOUT_S
        );
        ranGen.current.set(index, gen);
        h.setResult({ running: false, result: res, note: silentNote ?? null, ms: Math.round(performance.now() - t0) });
        return res.ok;
      } catch (e) {
        h.setResult({ running: false, result: { ok: false, outputs: [], error: null }, note: stopMessage(e, RUN_TIMEOUT_S) });
        return false;
      }
    },
    [nsKey, setup, files]
  );

  const api = useMemo<LessonRunApi>(
    () => ({
      register(index, h) {
        handles.current.set(index, h);
        return () => handles.current.delete(index);
      },
      async runExample(index) {
        // безопасная точка: после перезапуска ниже сменится поколение, и предыдущие примеры выполнятся заново
        py.relieveMemory();
        py.preload();
        const gen = py.state.generation;
        const missing = Array.from(handles.current.keys())
          .filter((i) => i < index && ranGen.current.get(i) !== gen)
          .sort((a, b) => a - b);
        for (const i of missing) {
          const ok = await execOne(i, "Запущен автоматически: следующий пример использует его переменные.");
          if (!ok) {
            handles.current.get(index)?.setResult({ running: false, result: null, note: `Сначала исправьте ошибку в примере ${i + 1} выше — этот пример использует его результаты.` });
            return;
          }
        }
        await execOne(index);
      },
      resetLesson() {
        ranGen.current.clear();
      },
    }),
    [execOne]
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useLessonRun(): LessonRunApi | null {
  return useContext(Ctx);
}
