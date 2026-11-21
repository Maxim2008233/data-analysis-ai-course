import type { Metadata } from "next";
import Link from "next/link";
import { buildCourseIndex, loadCourse } from "@/lib/content/load";
import { CourseProgressSummary, ModuleProgress } from "@/components/course/CourseClient";
import { BrandMark } from "@/components/Sidebar";
import { plural, LESSON, PART, TASK } from "@/lib/plural";

export const metadata: Metadata = { title: "Курсы" };

export default function CoursesPage() {
  const course = loadCourse();
  const index = buildCourseIndex(course);
  const lessons = index.modules.reduce((n, m) => n + m.lessons.length, 0);
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      <p className="font-display text-lg italic text-warm-ink">Курсы</p>
      <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight">Что изучаем</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Можно пройти основной курс целиком по порядку или взять отдельный модуль как мини-курс. Прогресс общий: решённое в мини-курсе засчитывается и в основном.
      </p>

      <Link href="/course" className="paper mt-8 grid gap-6 p-6 hover:border-accent sm:grid-cols-[auto_minmax(0,1fr)]" data-testid="main-course-card">
        <div className="flex h-28 w-24 flex-col justify-between rounded-[4px] border-l-[6px] border-warm bg-accent p-3 text-[var(--bg-elev)] dark:text-[#0c1422]">
          <BrandMark size={28} />
          <span className="font-display text-sm font-semibold leading-tight">АД и ИИ</span>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-muted">Основной курс</p>
          <h2 className="mt-1 font-display text-2xl font-semibold">{course.title}</h2>
          <p className="mt-1 text-sm text-muted">
            {plural(index.modules.length, PART)} · {plural(lessons, LESSON)} · {plural(index.tasks.length, TASK)} · порядок как в программе 2026 года
          </p>
          <div className="mt-4">
            <CourseProgressSummary index={index} />
          </div>
        </div>
      </Link>

      <h2 className="mt-12 font-display text-2xl font-semibold">Мини-курсы по модулям</h2>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {index.modules.map((m) => (
          <Link key={m.id} href={`/course/${m.slug}`} className="paper group flex gap-4 p-4 hover:border-accent" data-testid="module-card">
            <span className="font-display text-4xl font-semibold leading-none text-warm-ink/80 tabular-nums">
              {m.kind === "module" ? String(m.number).padStart(2, "0") : m.kind === "checkpoint" ? "КТ" : m.kind === "competition" ? "★" : "+"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs uppercase tracking-wider text-muted">{m.label}</span>
              <span className="block font-semibold leading-snug group-hover:underline">{m.title}</span>
              <span className="mt-1 line-clamp-2 block text-sm text-muted">{m.description}</span>
              <span className="mt-3 block">
                <ModuleProgress mod={m} />
              </span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
