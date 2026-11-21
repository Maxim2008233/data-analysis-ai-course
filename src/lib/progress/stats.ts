// Подсчёт статусов уроков и модулей по прогрессу.
import type { CourseIndex, LessonIndexItem, ModuleIndexItem } from "../content/types";
import type { ItemsMap } from "./merge";

export type LessonStatus = "not_started" | "in_progress" | "solved";

export const taskKey = (id: string) => `task:${id}`;
export const lessonKey = (id: string) => `lesson:${id}`;
export const compKey = (id: string) => `comp:${id}`;

export function lessonStatus(lesson: LessonIndexItem, items: ItemsMap): LessonStatus {
  const lp = items[lessonKey(lesson.id)];
  const required = lesson.requiredTaskIds;
  const solved = required.filter((id) => items[taskKey(id)]?.status === "solved").length;
  const touched =
    Boolean(lp?.theoryRead) ||
    Object.keys(lp?.quiz ?? {}).length > 0 ||
    lesson.taskIds.some((id) => {
      const t = items[taskKey(id)];
      return t && (t.status === "in_progress" || t.status === "solved" || (t.attempts ?? 0) > 0);
    });
  if (required.length === 0) {
    return lp?.theoryRead ? "solved" : touched ? "in_progress" : "not_started";
  }
  if (solved === required.length && (lp?.theoryRead || required.length > 0)) return "solved";
  return touched ? "in_progress" : "not_started";
}

export function moduleStats(mod: ModuleIndexItem, items: ItemsMap) {
  const lessons = mod.lessons.filter((l) => !l.optional);
  const doneLessons = lessons.filter((l) => lessonStatus(l, items) === "solved").length;
  const taskIds = mod.lessons.flatMap((l) => l.taskIds);
  const solvedTasks = taskIds.filter((id) => items[taskKey(id)]?.status === "solved").length;
  return {
    lessons: lessons.length,
    doneLessons,
    tasks: taskIds.length,
    solvedTasks,
    percent: taskIds.length ? Math.round((solvedTasks / taskIds.length) * 100) : lessons.length ? Math.round((doneLessons / lessons.length) * 100) : 0,
  };
}

export function courseStats(index: CourseIndex, items: ItemsMap) {
  let attempts = 0;
  let hints = 0;
  let solutions = 0;
  let solved = 0;
  for (const t of index.tasks) {
    const p = items[taskKey(t.id)];
    if (!p) continue;
    attempts += p.attempts ?? 0;
    hints += p.hints ?? 0;
    if (p.solutionShown) solutions++;
    if (p.status === "solved") solved++;
  }
  const lessons = index.modules.flatMap((m) => m.lessons);
  const doneLessons = lessons.filter((l) => lessonStatus(l, items) === "solved").length;
  return { tasks: index.tasks.length, solved, attempts, hints, solutions, lessons: lessons.length, doneLessons };
}

/** Где продолжить: первый незавершённый урок после последнего тронутого. */
export function continueHref(index: CourseIndex, items: ItemsMap): { href: string; title: string; started: boolean } {
  const lessons = index.modules.flatMap((m) => m.lessons.map((l) => ({ m, l })));
  let lastTouched = -1;
  lessons.forEach((x, i) => {
    if (lessonStatus(x.l, items) !== "not_started") lastTouched = i;
  });
  if (lastTouched < 0) {
    const first = lessons[0];
    return { href: first?.l.href ?? "/course", title: first ? `${first.l.number} ${first.l.title}` : "", started: false };
  }
  const cur = lessons[lastTouched];
  if (lessonStatus(cur.l, items) !== "solved") return { href: cur.l.href, title: `${cur.l.number} ${cur.l.title}`, started: true };
  const next = lessons.slice(lastTouched + 1).find((x) => lessonStatus(x.l, items) !== "solved") ?? cur;
  return { href: next.l.href, title: `${next.l.number} ${next.l.title}`, started: true };
}
