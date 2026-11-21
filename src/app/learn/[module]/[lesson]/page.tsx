import type { Metadata } from "next";
import Link from "next/link";
import { Fragment } from "react";
import { notFound } from "next/navigation";
import type { Components } from "hast-util-to-jsx-runtime";
import { buildCourseIndex, conceptIntroductions, conceptMap, findLesson, lessonHref, loadCourse } from "@/lib/content/load";
import { quizIdsIn, quizToView, renderMarkdown, splitSections } from "@/lib/content/markdown";
import { highlightPython } from "@/lib/highlight";
import { LessonRunProvider } from "@/components/lesson/LessonRun";
import { RunnableCode } from "@/components/lesson/RunnableCode";
import { LessonQuiz } from "@/components/lesson/Quiz";
import { CompetitionSubmit } from "@/components/competition/CompetitionSubmit";
import { Callout, StaticCode, SvgFigure, TableWrap } from "@/components/lesson/blocks";
import { TaskCard, type ClientTask } from "@/components/lesson/TaskCard";
import { LessonSteps, type StepMeta } from "@/components/lesson/LessonSteps";
import { LessonStatusDot, LessonTaskCounter } from "@/components/lesson/LessonClientParts";
import { ReferencePanelButton } from "@/components/reference/ReferenceBrowser";
import { Badge } from "@/components/ui";

export const dynamicParams = false;

export function generateStaticParams() {
  const course = loadCourse();
  return course.modules.flatMap((m) => m.lessons.map((l) => ({ module: m.slug, lesson: l.slug })));
}

type Params = Promise<{ module: string; lesson: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { module, lesson } = await params;
  const found = findLesson(module, lesson);
  if (!found) return {};
  return { title: `${found.lesson.number} ${found.lesson.title}`, description: found.lesson.summary || found.module.title };
}

const theoryComponents: Partial<Components> = {
  "runnable-code": ((p: { code: string; index: string; html: string }) => <RunnableCode code={p.code} index={p.index} html={p.html} />) as never,
  "lesson-quiz": ((p: { json: string; quizid: string; lessonid: string }) => <LessonQuiz json={p.json} quizid={p.quizid} lessonid={p.lessonid} />) as never,
  "competition-submit": ((p: { competition: string; code: string; html: string }) => <CompetitionSubmit competition={p.competition} code={p.code} html={p.html} />) as never,
  callout: ((p: { kind: string; title?: string; children?: React.ReactNode }) => <Callout kind={p.kind} title={p.title}>{p.children}</Callout>) as never,
  "svg-figure": ((p: { svg: string; alt?: string; caption?: string }) => <SvgFigure svg={p.svg} alt={p.alt} caption={p.caption} />) as never,
  "static-code": ((p: { html: string; lang?: string }) => <StaticCode html={p.html} lang={p.lang} />) as never,
  table: TableWrap as never,
};

const smallComponents: Partial<Components> = {
  "static-code": ((p: { html: string; lang?: string }) => <StaticCode html={p.html} lang={p.lang} />) as never,
  table: TableWrap as never,
  callout: ((p: { kind: string; title?: string; children?: React.ReactNode }) => <Callout kind={p.kind} title={p.title}>{p.children}</Callout>) as never,
};

const TYPE_LABEL: Record<string, string> = {
  theory: "Урок",
  warmup: "Разминка",
  guide: "Инструкция",
  project: "Мини-проект",
  checkpoint: "Контрольная точка",
  competition: "Соревнование",
};

export default async function LessonPage({ params }: { params: Params }) {
  const { module: moduleSlug, lesson: lessonSlug } = await params;
  const found = findLesson(moduleSlug, lessonSlug);
  if (!found) notFound();
  const { course, module: mod, lesson, next } = found;
  const concepts = conceptMap(course);
  const intro = conceptIntroductions(course);
  const index = buildCourseIndex(course);
  const lessonIndex = index.modules.find((m) => m.id === mod.id)!.lessons.find((l) => l.id === lesson.id)!;
  const md = (text: string) => renderMarkdown(text, smallComponents, { dir: lesson.dir, lessonId: lesson.id });

  const tasks = lesson.tasks.map((t, i) => {
    const number = `${lesson.number}.${i + 1}`;
    const client: ClientTask = {
      id: t.id,
      number,
      title: t.title,
      kind: t.kind,
      difficulty: t.difficulty,
      prelude: t.prelude,
      starter: t.starter,
      solution: t.solution,
      tests: t.tests,
      files: t.files?.length ? t.files : lesson.files,
      timeout: t.timeout,
      quiz: t.quiz ? quizToView(t.quiz) : undefined,
      hintCount: t.hints.length,
    };
    const recallItems = t.uses
      .map((id) => ({ id, c: concepts.get(id), where: intro.get(id) }))
      .filter((x) => x.c && x.where && x.where.lesson.id !== lesson.id);
    const recall = recallItems.length ? (
      <div className="rounded-r-md border-l-4 border-accent bg-accent-soft/40 p-3" data-testid="recall">
        <p className="mb-1.5 font-display text-sm font-semibold italic text-accent-ink">↺ Вспомним</p>
        <ul className="space-y-2.5">
          {recallItems.map(({ id, c, where }) => (
            <li key={id} className="text-sm">
              <span className="font-semibold">{c!.title}.</span> <span className="md inline [&>p]:inline">{md(c!.recall)}</span>
              {c!.example && <pre className="code-block mt-1.5 !py-1.5 text-[0.8rem]" dangerouslySetInnerHTML={{ __html: highlightPython(c!.example.replace(/\s+$/, "")) }} />}
              <Link href={lessonHref(where!.module.slug, where!.lesson.slug)} className="mt-0.5 inline-block text-xs text-accent-ink underline">
                Урок {where!.lesson.number} «{where!.lesson.title}»
              </Link>
            </li>
          ))}
        </ul>
      </div>
    ) : undefined;
    return (
      <TaskCard
        key={t.id}
        task={client}
        statement={md(t.statement)}
        hints={t.hints.map((h, hi) => <Fragment key={hi}>{md(h)}</Fragment>)}
        explanation={t.explanation ? md(t.explanation) : undefined}
        recall={recall}
        preludeNote={t.preludeNote ? md(t.preludeNote) : undefined}
        preludeHtml={t.prelude ? highlightPython(t.prelude) : undefined}
        solutionHtml={t.solution ? highlightPython(t.solution.replace(/\s+$/, "")) : undefined}
        starterHtml={highlightPython(t.starter ?? "")}
      />
    );
  });

  // теория урока → шаги по разделам «## …» (нумерация примеров и квизов сквозная по уроку)
  const sections = splitSections(lesson.body);
  let runOffset = 0;
  let quizOffset = 0;
  const steps: StepMeta[] = [];
  const contents: React.ReactNode[] = [];
  sections.forEach((sec, i) => {
    const body = renderMarkdown(sec.markdown, theoryComponents, { dir: lesson.dir, lessonId: lesson.id, runnable: true, runOffset, quizOffset });
    const quizIds = sec.quizCount ? quizIdsIn(sec.markdown, lesson.id, quizOffset) : undefined;
    runOffset += sec.runnableCount;
    quizOffset += sec.quizCount;
    steps.push({ id: `s${i + 1}`, kind: sec.isQuiz ? "quiz" : "text", title: sec.title || lesson.title, quizIds, isTheory: true });
    contents.push(
      <article key={`s${i + 1}`} className="lesson-prose" data-testid="lesson-theory">
        {body}
      </article>
    );
  });
  lesson.tasks.forEach((t, i) => {
    steps.push({ id: t.id, kind: t.kind, title: t.title, taskId: t.id, isTheory: false });
    contents.push(<Fragment key={t.id}>{tasks[i]}</Fragment>);
  });

  return (
    <div className="mx-auto max-w-[50rem] px-4 py-8 sm:px-8">
      <nav className="mb-5 flex flex-wrap items-center gap-1 text-sm text-muted" aria-label="Навигация по курсу">
        <Link href="/course" className="hover:text-ink">
          Курс
        </Link>
        <span aria-hidden="true">/</span>
        <Link href={`/course/${mod.slug}`} className="hover:text-ink">
          {mod.short === mod.label ? mod.label : `${mod.label}. ${mod.short}`}
        </Link>
      </nav>

      {/* шапка «листа журнала» */}
      <header className="paper graph-paper relative overflow-hidden p-5 sm:p-7">
        <div className="absolute inset-y-0 left-0 w-1.5 bg-warm" aria-hidden="true" />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-6">
          <div className="font-display text-5xl font-semibold leading-none text-warm-ink tabular-nums sm:text-7xl">{lesson.number}</div>
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <LessonStatusDot lesson={lessonIndex} />
              <Badge tone="warm">{TYPE_LABEL[lesson.type]}</Badge>
              {lesson.optional && <Badge tone="warn">необязательно</Badge>}
              <Badge>≈ {lesson.duration} мин</Badge>
            </div>
            <h1 className="font-display text-[1.7rem] font-semibold leading-tight tracking-tight break-words hyphens-auto sm:text-[2.15rem]">{lesson.title}</h1>
            {lesson.summary && <p className="mt-2 text-[1.05rem] leading-relaxed text-muted">{lesson.summary}</p>}
            <div className="mt-3">
              <LessonTaskCounter taskIds={lessonIndex.taskIds} requiredIds={lessonIndex.requiredTaskIds} />
            </div>
          </div>
        </div>
      </header>

      <div className="mt-8">
        <LessonRunProvider lessonId={lesson.id} setup={lesson.setup} files={lesson.files}>
          <LessonSteps
            lessonId={lesson.id}
            steps={steps}
            contents={contents}
            next={next ? { href: lessonHref(next.m.slug, next.l.slug), title: `${next.l.number} ${next.l.title}` } : null}
          />
        </LessonRunProvider>
      </div>
      <ReferencePanelButton />
    </div>
  );
}
