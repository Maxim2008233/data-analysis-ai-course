import type { Metadata } from "next";
import { buildCourseIndex, loadCourse } from "@/lib/content/load";
import { TaskBrowser } from "@/components/course/TaskBrowser";

export const metadata: Metadata = { title: "Задачи" };

export default function TasksPage() {
  const course = loadCourse();
  const index = buildCourseIndex(course);
  const modules = index.modules.map((m) => ({ id: m.id, label: m.short === m.label ? m.label : `${m.label}. ${m.short}` }));
  const lessonTitles: Record<string, string> = {};
  for (const m of index.modules) for (const l of m.lessons) lessonTitles[l.id] = `${l.number} ${l.title}`;
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="font-display text-4xl font-semibold tracking-tight">Задачи</h1>
      <p className="mt-2 text-muted">Все задания курса. Фильтруйте по модулю, сложности, типу и статусу.</p>
      <TaskBrowser tasks={index.tasks} modules={modules} lessonTitles={lessonTitles} />
    </div>
  );
}
