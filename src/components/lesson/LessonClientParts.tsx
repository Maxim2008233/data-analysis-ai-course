"use client";
// Части страницы урока, зависящие от прогресса ученика.
import Link from "next/link";
import { useAllProgress } from "@/lib/progress/store";
import { lessonStatus, taskKey } from "@/lib/progress/stats";
import type { LessonIndexItem } from "@/lib/content/types";
import { StatusDot } from "../ui";

export function LessonTaskCounter({ taskIds, requiredIds }: { taskIds: string[]; requiredIds: string[] }) {
  const items = useAllProgress();
  const solved = taskIds.filter((id) => items[taskKey(id)]?.status === "solved").length;
  const req = requiredIds.filter((id) => items[taskKey(id)]?.status === "solved").length;
  if (!taskIds.length) return null;
  return (
    <span className="text-sm text-muted" data-testid="lesson-task-counter">
      Решено заданий: <b className="text-ink">{solved}</b> из {taskIds.length}
      {requiredIds.length !== taskIds.length && <span> (обязательных {req} из {requiredIds.length})</span>}
    </span>
  );
}

export function LessonStatusDot({ lesson }: { lesson: LessonIndexItem }) {
  const items = useAllProgress();
  return <StatusDot status={lessonStatus(lesson, items)} />;
}

export function OutlineTasks({ tasks }: { tasks: { id: string; number: string; title: string }[] }) {
  const items = useAllProgress();
  return (
    <ul className="space-y-1">
      {tasks.map((t) => {
        const st = items[taskKey(t.id)]?.status ?? "not_started";
        return (
          <li key={t.id}>
            <a href={`#${t.id}`} className="flex items-start gap-2 rounded px-1 py-0.5 text-sm text-muted hover:text-ink">
              <span className="mt-0.5 scale-75">
                <StatusDot status={st} />
              </span>
              <span className="leading-snug">
                {t.number} {t.title}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export function LessonNavLink({ href, label, title, dir }: { href: string; label: string; title: string; dir: "prev" | "next" }) {
  return (
    <Link
      href={href}
      className={`flex min-w-0 flex-1 flex-col paper px-4 py-3 hover:border-accent ${dir === "next" ? "items-end text-right" : ""}`}
      data-testid={dir === "next" ? "next-lesson" : "prev-lesson"}
    >
      <span className="text-xs text-muted">{label}</span>
      <span className="truncate font-medium text-ink">{title}</span>
    </Link>
  );
}
