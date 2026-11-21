"use client";
// Урок как последовательность шагов: полоска шагов сверху, один шаг на экране, «Следующий шаг» внизу.
// Шаг выбирается по адресу (#step-3 или #<id задания>), поэтому ссылки на задания и кнопка «Назад» работают.
// Все шаги остаются в DOM (неактивные скрыты) — так не теряются переменные примеров и код в редакторах.
import Link from "next/link";
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { progressStore, useAllProgress } from "@/lib/progress/store";
import { lessonKey, taskKey } from "@/lib/progress/stats";
import { decodeHash } from "@/lib/url";

export type StepKind = "text" | "quiz" | "code" | "bug" | "predict" | "plot";

export interface StepMeta {
  id: string;
  kind: StepKind;
  title: string;
  taskId?: string;
  quizIds?: string[];
  isTheory: boolean;
}

type StepStatus = "solved" | "progress" | "todo";

const ICONS: Record<StepKind, string> = {
  text: "M5 6h14M5 10h14M5 14h10M5 18h7",
  quiz: "M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
  predict: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  code: "M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14",
  bug: "M9 9h6v8a3 3 0 0 1-6 0zM9 13H5M15 13h4M9 10L6 7M15 10l3-3M9 17l-3 2M15 17l3 2M10 6a2 2 0 0 1 4 0v3h-4z",
  plot: "M4 20h16M7 16v-5M12 16V7M17 16v-8",
};

const KIND_TITLE: Record<StepKind, string> = {
  text: "Теория",
  quiz: "Тест",
  predict: "Предскажи вывод",
  code: "Задача с кодом",
  bug: "Найди ошибку",
  plot: "График",
};

function subscribeHash(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}
const readHash = () => decodeHash(window.location.hash);

export function LessonSteps({
  lessonId,
  steps,
  contents,
  next,
}: {
  lessonId: string;
  steps: StepMeta[];
  contents: ReactNode[];
  next?: { href: string; title: string } | null;
}) {
  const items = useAllProgress();
  const hash = useSyncExternalStore(subscribeHash, readHash, () => "");
  const stripRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  let active = 0;
  const m = /^step-(\d+)$/.exec(hash);
  if (m) active = Math.min(Math.max(Number(m[1]) - 1, 0), steps.length - 1);
  else if (hash) {
    const i = steps.findIndex((s) => s.taskId === hash || s.id === hash);
    if (i >= 0) active = i;
  }

  const lp = items[lessonKey(lessonId)];
  const maxStep = lp?.maxStep ?? -1;
  const theoryCount = steps.filter((s) => s.isTheory).length;

  // отметить открытый шаг; дошли до конца теории — теория прочитана
  useEffect(() => {
    const cur = progressStore.get(lessonKey(lessonId));
    const reachedTheoryEnd = theoryCount > 0 && active >= theoryCount - 1;
    if ((cur?.maxStep ?? -1) >= active && (!reachedTheoryEnd || cur?.theoryRead)) return;
    progressStore.update(lessonKey(lessonId), (p) => ({
      ...p,
      maxStep: Math.max(p?.maxStep ?? -1, active),
      ...(reachedTheoryEnd && !p?.theoryRead ? { theoryRead: true, theoryReadAt: Date.now() } : {}),
    }));
  }, [active, lessonId, theoryCount]);

  // при смене шага — показать полоску шагов (кроме первого показа страницы)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      if (!hash) return;
    }
    stripRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [active, hash]);

  const statusOf = (s: StepMeta, i: number): StepStatus => {
    if (s.taskId) {
      const st = items[taskKey(s.taskId)]?.status;
      return st === "solved" ? "solved" : st === "in_progress" ? "progress" : "todo";
    }
    if (s.kind === "quiz" && s.quizIds?.length) {
      const quiz = lp?.quiz ?? {};
      const answered = s.quizIds.filter((q) => quiz[q]);
      if (answered.length && s.quizIds.every((q) => quiz[q]?.correct)) return "solved";
      return answered.length ? "progress" : "todo";
    }
    return i <= maxStep || lp?.theoryRead ? "solved" : "todo";
  };

  const go = (i: number) => {
    // новый адрес шага в истории браузера (кнопка «Назад» вернёт на прошлый шаг) и уведомление подписчиков
    window.history.pushState(null, "", `#step-${i + 1}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };
  const passed = steps.filter((s, i) => statusOf(s, i) === "solved").length;
  const cur = steps[active];

  return (
    <div>
      <div ref={stripRef} className="scroll-mt-16 lg:scroll-mt-4" data-testid="step-strip">
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Шаги урока">
          {steps.map((s, i) => {
            const st = statusOf(s, i);
            const isActive = i === active;
            const tone =
              st === "solved"
                ? "border-ok bg-ok text-white dark:text-[#0e1a13]"
                : st === "progress"
                  ? "border-warm text-warm-ink"
                  : "border-line-strong text-muted hover:border-accent";
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={`Шаг ${i + 1}: ${s.title} (${KIND_TITLE[s.kind]}${st === "solved" ? ", пройден" : st === "progress" ? ", в процессе" : ""})`}
                title={`${i + 1}. ${s.title}`}
                onClick={() => go(i)}
                className={`relative inline-flex h-9 w-9 items-center justify-center rounded-[5px] border-2 transition ${tone} ${isActive ? "ring-2 ring-accent ring-offset-2 ring-offset-[var(--bg)]" : ""}`}
                style={st === "progress" ? { background: "repeating-linear-gradient(135deg, color-mix(in srgb, var(--warm) 22%, transparent) 0 3px, transparent 3px 6px)" } : undefined}
                data-testid="step-button"
                data-status={st}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={ICONS[s.kind]} />
                </svg>
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 text-sm">
          <span className="font-display font-semibold text-ink" data-testid="step-title">
            Шаг {active + 1} из {steps.length} · {cur?.title}
          </span>
          <span className="text-muted">
            {KIND_TITLE[cur?.kind ?? "text"]} · пройдено шагов: {passed} из {steps.length}
          </span>
        </div>
      </div>

      <div className="mt-6">
        {contents.map((c, i) => (
          <div key={steps[i].id} hidden={i !== active} data-step={i + 1} role="tabpanel" aria-label={`Шаг ${i + 1}`}>
            {c}
          </div>
        ))}
      </div>

      <nav className="mt-10 flex flex-wrap items-center gap-3 border-t border-dashed border-line-strong pt-5" aria-label="Переход между шагами">
        {active > 0 && (
          <button type="button" onClick={() => go(active - 1)} className="rounded-md border border-line-strong px-4 py-2.5 text-sm font-semibold hover:border-accent" data-testid="prev-step">
            ← Предыдущий шаг
          </button>
        )}
        <span className="flex-1" />
        {active < steps.length - 1 ? (
          <button type="button" onClick={() => go(active + 1)} className="rounded-md bg-ok px-5 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow)] hover:brightness-110 dark:text-[#0e1a13]" data-testid="next-step">
            Следующий шаг →
          </button>
        ) : next ? (
          <Link href={next.href} className="rounded-md bg-ok px-5 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow)] hover:brightness-110 dark:text-[#0e1a13]" data-testid="next-lesson">
            Следующий урок: {next.title} →
          </Link>
        ) : (
          <span className="text-sm text-muted">Это последний шаг курса.</span>
        )}
      </nav>
    </div>
  );
}
