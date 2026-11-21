import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buildCourseIndex, loadCourse } from "@/lib/content/load";
import { ModuleLessonList, ModuleProgress } from "@/components/course/CourseClient";
import { plural, LESSON, TASK } from "@/lib/plural";

export const dynamicParams = false;

export function generateStaticParams() {
  return loadCourse().modules.map((m) => ({ module: m.slug }));
}

type Params = Promise<{ module: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { module } = await params;
  const m = loadCourse().modules.find((x) => x.slug === module);
  return m ? { title: `${m.label}. ${m.title}` } : {};
}

export default async function ModulePage({ params }: { params: Params }) {
  const { module } = await params;
  const course = loadCourse();
  const src = course.modules.find((x) => x.slug === module);
  if (!src) notFound();
  const mod = buildCourseIndex(course).modules.find((m) => m.id === src.id)!;
  const minutes = mod.lessons.reduce((n, l) => n + l.duration, 0);
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-8">
      <nav className="mb-4 text-sm text-muted">
        <Link href="/courses" className="hover:text-ink">
          Курсы
        </Link>{" "}
        /{" "}
        <Link href="/course" className="hover:text-ink">
          Основной курс
        </Link>
      </nav>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <span className="font-display text-7xl font-semibold leading-none text-warm-ink tabular-nums">
          {mod.kind === "module" ? String(mod.number).padStart(2, "0") : mod.kind === "checkpoint" ? "КТ" : mod.kind === "competition" ? "★" : "+"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg italic text-warm-ink">Мини-курс · {mod.label}</p>
          <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{mod.title}</h1>
        </div>
      </div>
      {mod.description && <p className="mt-4 max-w-3xl text-lg leading-relaxed text-muted">{mod.description}</p>}
      <div className="paper mt-6 grid gap-5 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div>
          <ModuleProgress mod={mod} />
          <p className="mt-2 text-sm text-muted">
            {plural(mod.lessons.length, LESSON)} · {plural(mod.lessons.reduce((n, l) => n + l.taskIds.length, 0), TASK)} · около {Math.round(minutes / 6) / 10} ч теории
          </p>
        </div>
        {mod.lessons[0] && (
          <Link href={mod.lessons[0].href} className="inline-flex rounded-md bg-ok px-4 py-2.5 font-semibold text-white dark:text-[#0e1a13]">
            К первому уроку →
          </Link>
        )}
      </div>
      <section className="mt-8">
        <h2 className="font-display text-xl font-semibold">Уроки</h2>
        <div className="mt-2">
          <ModuleLessonList mod={mod} />
        </div>
      </section>
      {src.sources.length > 0 && (
        <details className="mt-8 text-sm text-muted">
          <summary className="cursor-pointer">Исходные материалы курса для этого модуля</summary>
          <ul className="mt-2 list-disc pl-5">
            {src.sources.map((s) => (
              <li key={s} className="font-mono text-xs">
                {s}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
