import type { Metadata } from "next";
import Link from "next/link";
import { buildCourseIndex, loadCourse } from "@/lib/content/load";
import { ContinueButton, CourseProgressSummary, ModuleLessonList, ModuleProgress } from "@/components/course/CourseClient";
import { pluralWord, EXAMPLE, LESSON, PROBLEM, TEST } from "@/lib/plural";

export const metadata: Metadata = { title: "Оглавление курса" };

export default function CoursePage() {
  const course = loadCourse();
  const index = buildCourseIndex(course);
  const lessons = index.modules.flatMap((m) => m.lessons);
  const examples = lessons.reduce((n, l) => n + l.examples, 0);
  const codeTasks = index.tasks.filter((t) => t.kind === "code" || t.kind === "bug" || t.kind === "plot").length;
  const quizzes = index.tasks.filter((t) => t.kind === "quiz" || t.kind === "predict").length + lessons.filter((l) => l.hasQuiz).length;
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-8">
      <p className="font-display text-lg italic text-warm-ink">Основной курс · оглавление</p>
      <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight">{course.title}</h1>
      <div className="mt-6 grid gap-5 md:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="paper p-5">
          <CourseProgressSummary index={index} />
          <div className="mt-5">
            <ContinueButton index={index} />
          </div>
        </div>
        <aside className="paper p-5 text-sm" data-testid="course-includes">
          <p className="font-display text-base font-semibold">В курс входят</p>
          <ul className="mt-2 space-y-1.5">
            <li>
              <b>{lessons.length}</b> {pluralWord(lessons.length, LESSON)} в {index.modules.length} частях
            </li>
            <li>
              <b>{examples}</b> {pluralWord(examples, EXAMPLE)} кода для запуска на странице
            </li>
            <li>
              <b>{codeTasks}</b> {pluralWord(codeTasks, PROBLEM)} с кодом и автопроверкой
            </li>
            <li>
              <b>{quizzes}</b> {pluralWord(quizzes, TEST)} на понимание
            </li>
          </ul>
          <p className="mt-3 text-xs text-muted">Python работает прямо в браузере — ничего устанавливать не нужно.</p>
        </aside>
      </div>
      <div className="mt-10 space-y-10">
        {index.modules.map((m) => (
          <section key={m.id} id={m.id} className="scroll-mt-20" data-testid="module-section">
            <div className="flex flex-wrap items-end gap-x-5 gap-y-3 border-b-2 border-line pb-3">
              <span className="font-display text-5xl font-semibold leading-none text-warm-ink tabular-nums">
                {m.kind === "module" ? String(m.number).padStart(2, "0") : m.kind === "checkpoint" ? "КТ" : m.kind === "competition" ? "★" : "+"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs uppercase tracking-wider text-muted">{m.label}</p>
                <h2 className="font-display text-2xl font-semibold leading-snug">
                  <Link href={`/course/${m.slug}`} className="hover:underline">
                    {m.title}
                  </Link>
                </h2>
              </div>
              <div className="w-full sm:w-56">
                <ModuleProgress mod={m} />
              </div>
            </div>
            {m.description && <p className="mt-3 text-sm text-muted">{m.description}</p>}
            <div className="mt-2">
              <ModuleLessonList mod={m} />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
