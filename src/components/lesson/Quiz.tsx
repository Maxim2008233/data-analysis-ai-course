"use client";
// Квизы: мини-квиз в теории и задания-квизы. Ответы сохраняются в прогрессе.
import { useState } from "react";
import type { QuizQuestionView } from "@/lib/content/markdown";
import type { QuizAnswer } from "@/lib/progress/merge";
import { progressStore, useProgressItem } from "@/lib/progress/store";
import { lessonKey } from "@/lib/progress/stats";

function sameSet(a: number[], b: number[]) {
  const sa = [...a].sort().join(",");
  const sb = [...b].sort().join(",");
  return sa === sb;
}

export function QuizQuestions({
  questions,
  saved,
  onSubmit,
  testId,
  revealAll = false,
}: {
  questions: QuizQuestionView[];
  saved?: Record<string, QuizAnswer>;
  onSubmit: (answers: Record<string, QuizAnswer>) => void;
  testId?: string;
  revealAll?: boolean;
}) {
  const [choice, setChoice] = useState<Record<string, number[]>>(() => {
    const init: Record<string, number[]> = {};
    for (const q of questions) if (saved?.[q.id]) init[q.id] = saved[q.id].answer;
    return init;
  });
  const [checked, setChecked] = useState<boolean>(() => questions.every((q) => saved?.[q.id]));

  function toggle(q: QuizQuestionView, i: number) {
    setChecked(false);
    setChoice((prev) => {
      const cur = prev[q.id] ?? [];
      if (q.multiple) return { ...prev, [q.id]: cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i] };
      return { ...prev, [q.id]: [i] };
    });
  }

  function submit() {
    const now = Date.now();
    const res: Record<string, QuizAnswer> = {};
    for (const q of questions) {
      const a = choice[q.id] ?? [];
      res[q.id] = { answer: a, correct: sameSet(a, q.answer), at: now };
    }
    setChecked(true);
    onSubmit(res);
  }

  const allAnswered = questions.every((q) => (choice[q.id] ?? []).length > 0);
  const correctCount = questions.filter((q) => sameSet(choice[q.id] ?? [], q.answer)).length;

  return (
    <div className="space-y-5" data-testid={testId}>
      {questions.map((q, qi) => {
        const sel = choice[q.id] ?? [];
        const ok = sameSet(sel, q.answer);
        return (
          <fieldset key={q.id} className="space-y-2" data-testid="quiz-question">
            <legend className="md mb-1 font-medium text-ink">
              <span className="mr-1 text-muted">{qi + 1}.</span>
              <span dangerouslySetInnerHTML={{ __html: q.qHtml.replace(/^<p>|<\/p>\s*$/g, "") }} />
            </legend>
            {q.multiple && <p className="text-xs text-muted">Можно выбрать несколько вариантов.</p>}
            {q.codeHtml && <pre className="code-block" dangerouslySetInnerHTML={{ __html: q.codeHtml }} />}
            <div className="space-y-1.5">
              {(q.order ?? q.optionsHtml.map((_, k) => k)).map((i) => {
                const o = q.optionsHtml[i];
                const picked = sel.includes(i);
                const isRight = q.answer.includes(i);
                let tone = "border-line hover:bg-soft";
                if ((checked || revealAll) && isRight) tone = "border-ok bg-ok-soft";
                else if (checked && picked && !isRight) tone = "border-bad bg-bad-soft";
                else if (picked) tone = "border-accent bg-accent-soft";
                return (
                  <label key={i} data-option={i} className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-[0.95rem] ${tone}`}>
                    <input
                      type={q.multiple ? "checkbox" : "radio"}
                      name={q.id}
                      checked={picked}
                      onChange={() => toggle(q, i)}
                      className="mt-1 accent-[var(--accent)]"
                    />
                    <span className="md" dangerouslySetInnerHTML={{ __html: o }} />
                  </label>
                );
              })}
            </div>
            {(checked || revealAll) && (
              <div className={`rounded-lg px-3 py-2 text-sm ${ok || revealAll ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`} data-testid="quiz-feedback">
                <p className="font-medium">{revealAll ? "Правильный ответ отмечен зелёным." : ok ? "Верно!" : "Пока неверно."}</p>
                {q.explainHtml && (ok || revealAll) && <div className="md mt-1 text-ink" dangerouslySetInnerHTML={{ __html: q.explainHtml }} />}
                {!ok && !revealAll && <p className="mt-1 text-ink">Перечитайте вопрос и попробуйте ещё раз.</p>}
              </div>
            )}
          </fieldset>
        );
      })}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={!allAnswered}
          className="rounded-lg bg-ok px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:text-[#0e1a13]"
          data-testid="quiz-submit"
        >
          Проверить ответы
        </button>
        {checked && (
          <span className={`text-sm ${correctCount === questions.length ? "text-ok" : "text-muted"}`} data-testid="quiz-score">
            Верно: {correctCount} из {questions.length}
          </span>
        )}
      </div>
    </div>
  );
}

/** Мини-квиз в теории урока. */
export function LessonQuiz({ json, quizid, lessonid }: { json: string; quizid: string; lessonid: string }) {
  const questions = JSON.parse(json) as QuizQuestionView[];
  const key = lessonKey(lessonid);
  const item = useProgressItem(key);
  return (
    <div className="not-prose my-6 paper p-4 sm:p-5" data-testid="lesson-quiz" data-quiz-id={quizid}>
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-accent-ink">Мини-квиз</p>
      <QuizQuestions
        questions={questions}
        saved={item?.quiz}
        onSubmit={(answers) => progressStore.update(key, (prev) => ({ ...prev, quiz: { ...(prev?.quiz ?? {}), ...answers } }))}
      />
    </div>
  );
}
