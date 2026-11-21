"use client";
// Компоненты, показывающие прогресс ученика: «Продолжить», сводка по курсу, клетки модулей, оглавление уроков.
import Link from "next/link";
import { useAllProgress, useProgressVersion } from "@/lib/progress/store";
import { continueHref, courseStats, lessonStatus, moduleStats } from "@/lib/progress/stats";
import type { CourseIndex, ModuleIndexItem } from "@/lib/content/types";
import { Badge, Cells, SegmentBar, StatusDot } from "../ui";

export function ContinueButton({ index, className = "" }: { index: CourseIndex; className?: string }) {
  const items = useAllProgress();
  const version = useProgressVersion();
  const c = continueHref(index, items);
  return (
    <Link
      href={c.href}
      className={`inline-flex items-center justify-center gap-2 rounded-md bg-ok px-5 py-3 text-base font-semibold text-white shadow-[var(--shadow)] hover:brightness-110 dark:text-[#0e1a13] ${className}`}
      data-testid="continue-button"
    >
      {version > 0 && c.started ? "Продолжить с места остановки" : "Начать с первого урока"}
      <span aria-hidden="true">→</span>
    </Link>
  );
}

export function ContinueHint({ index }: { index: CourseIndex }) {
  const items = useAllProgress();
  const c = continueHref(index, items);
  if (!c.started) return null;
  return <p className="mt-3 text-sm text-muted">Следующий урок: {c.title}</p>;
}

export function CourseProgressSummary({ index }: { index: CourseIndex }) {
  const items = useAllProgress();
  const s = courseStats(index, items);
  const segments = index.modules.map((m) => {
    const ms = moduleStats(m, items);
    return { done: ms.solvedTasks, total: ms.tasks, title: m.short === m.label ? m.label : `${m.label}. ${m.short}` };
  });
  return (
    <div className="space-y-3" data-testid="course-progress">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <p>
          <span className="font-display text-3xl font-semibold tabular-nums" data-testid="solved-count">
            {s.solved}
          </span>
          <span className="text-muted"> / {s.tasks} задач решено</span>
        </p>
        <p className="text-sm text-muted">
          уроков пройдено: {s.doneLessons} из {s.lessons}
        </p>
      </div>
      <SegmentBar segments={segments} label="Решено задач по модулям" />
      <p className="text-xs text-muted">Каждый отрезок полосы — модуль курса.</p>
    </div>
  );
}

export function ModuleProgress({ mod }: { mod: ModuleIndexItem }) {
  const items = useAllProgress();
  const s = moduleStats(mod, items);
  return (
    <div className="space-y-1.5">
      <Cells statuses={mod.lessons.map((l) => lessonStatus(l, items))} />
      <p className="text-xs text-muted">
        {s.tasks ? `задач: ${s.solvedTasks} из ${s.tasks}` : `уроков: ${s.doneLessons} из ${s.lessons}`} · клетка — урок
      </p>
    </div>
  );
}

const TYPE_BADGE: Record<string, string> = { warmup: "разминка", guide: "инструкция", project: "проект", checkpoint: "проверка", competition: "соревнование" };

export function ModuleLessonList({ mod }: { mod: ModuleIndexItem }) {
  const items = useAllProgress();
  return (
    <ol>
      {mod.lessons.map((l) => {
        const st = lessonStatus(l, items);
        return (
          <li key={l.id}>
            <Link href={l.href} className="group flex items-center gap-3 rounded-md px-1 py-2 hover:bg-soft sm:px-2" data-testid="lesson-link" data-status={st}>
              <StatusDot status={st} />
              <span className="w-9 shrink-0 font-display text-[0.95rem] font-semibold tabular-nums text-warm-ink">{l.number}</span>
              <span className="min-w-0 text-[0.97rem] leading-snug group-hover:underline">
                {l.title}
                {l.optional && <span className="ml-2 text-xs italic text-muted">необязательно</span>}
              </span>
              <span className="hidden min-w-[1rem] flex-1 translate-y-1 border-b border-dotted border-line-strong sm:block" aria-hidden="true" />
              <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
                {l.type !== "theory" && <Badge tone="warm">{TYPE_BADGE[l.type]}</Badge>}
                <span className="text-xs tabular-nums text-muted">{l.taskIds.length ? `${l.taskIds.length} зад.` : `${l.duration} мин`}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
