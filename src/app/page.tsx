import Link from "next/link";
import { buildCourseIndex, loadCourse } from "@/lib/content/load";
import { ContinueButton, ContinueHint, CourseProgressSummary, ModuleProgress } from "@/components/course/CourseClient";
import { HeroFigure } from "@/components/HeroFigure";
import { plural, LESSON, TASK } from "@/lib/plural";

const STEPS = [
  { n: "I", title: "Объяснение", text: "Зачем нужна тема, простые слова, формулы с разбором на числах, схемы." },
  { n: "II", title: "Опыт", text: "Примеры кода прямо на странице: меняйте числа и запускайте снова." },
  { n: "III", title: "Задание", text: "От разминки до задач со звёздочкой, на одних и тех же данных об автомобилях." },
  { n: "IV", title: "Проверка", text: "Тесты объясняют, что не так. Три подсказки, затем — решение с разбором." },
];

export default function HomePage() {
  const course = loadCourse();
  const index = buildCourseIndex(course);
  const lessons = index.modules.reduce((n, m) => n + m.lessons.length, 0);

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-8">
      <section className="grid items-center gap-10 pb-10 pt-10 md:pt-14 xl:grid-cols-[1.1fr_1fr]">
        <div>
          <p className="font-display text-lg italic text-warm-ink">Лабораторный журнал курса</p>
          <h1 className="mt-2 font-display text-[2.6rem] font-semibold leading-[1.08] tracking-tight sm:text-[3.2rem]">
            Анализ данных
            <br />и искусственный интеллект
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-muted">
            Учимся на настоящих данных: 41 007 объявлений о продаже автомобилей. От первого массива NumPy до моделей машинного обучения, языковых моделей и агентов — с кодом,
            который выполняется прямо в браузере.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <ContinueButton index={index} />
            <Link href="/course" className="rounded-md border border-line-strong px-4 py-3 font-medium hover:border-accent">
              Оглавление курса
            </Link>
          </div>
          <ContinueHint index={index} />
        </div>
        <div className="paper mx-auto w-full max-w-md rotate-[0.6deg] p-2 sm:p-3 xl:max-w-none">
          <HeroFigure />
        </div>
      </section>

      <section className="paper p-5 sm:p-6">
        <CourseProgressSummary index={index} />
      </section>

      <section className="mt-14">
        <h2 className="font-display text-2xl font-semibold">Как устроен каждый урок</h2>
        <ol className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <li key={s.n} className="relative border-l-2 border-warm pl-4">
              <span className="font-display text-3xl font-semibold text-warm">{s.n}</span>
              <h3 className="mt-1 font-semibold">{s.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-14">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-2xl font-semibold">Оглавление</h2>
          <p className="text-sm text-muted">
            {plural(lessons, LESSON)} · {plural(index.tasks.length, TASK)}
          </p>
        </div>
        <ol className="mt-4 divide-y divide-dashed divide-line-strong border-y border-dashed border-line-strong">
          {index.modules.map((m) => (
            <li key={m.id}>
              <Link href={`/course/${m.slug}`} className="group grid gap-x-5 gap-y-2 py-4 sm:grid-cols-[3.5rem_minmax(0,1fr)_12rem] sm:items-center">
                <span className="font-display text-3xl font-semibold leading-none text-warm-ink tabular-nums">
                  {m.kind === "module" ? String(m.number).padStart(2, "0") : m.kind === "checkpoint" ? "КТ" : m.kind === "competition" ? "★" : "+"}
                </span>
                <span>
                  <span className="block text-xs uppercase tracking-wider text-muted">{m.label}</span>
                  <span className="block font-semibold leading-snug group-hover:underline">{m.title}</span>
                </span>
                <ModuleProgress mod={m} />
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
