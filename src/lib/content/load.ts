// Загрузка контента из папки content/ (только на сервере / в скриптах).
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type {
  Concept,
  Course,
  CourseIndex,
  GlossaryEntry,
  LessonFrontmatter,
  LessonSource,
  ModuleSource,
  QuizQuestion,
  TaskSource,
} from "./types";

export const CONTENT_DIR = path.join(process.cwd(), "content");

let cache: Course | null = null;

function readYaml<T>(file: string): T {
  const text = fs.readFileSync(file, "utf8");
  try {
    return YAML.parse(text) as T;
  } catch (e) {
    throw new Error(`Ошибка YAML в ${path.relative(process.cwd(), file)}: ${(e as Error).message}`);
  }
}

function splitFrontmatter(text: string, file: string): { fm: LessonFrontmatter; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) throw new Error(`Нет frontmatter (--- ... ---) в ${file}`);
  let fm: LessonFrontmatter;
  try {
    fm = YAML.parse(m[1]) as LessonFrontmatter;
  } catch (e) {
    throw new Error(`Ошибка YAML во frontmatter ${file}: ${(e as Error).message}`);
  }
  return { fm, body: m[2] };
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Строка из YAML. Элемент списка вида «- Текст: продолжение» YAML читает как словарь {Текст: продолжение} —
 * такую ошибку разметки показываем сразу, а не выводим «[object Object]».
 */
function asText(v: unknown, where: string): string {
  if (v !== null && typeof v === "object") {
    throw new Error(`${where}: значение прочитано как словарь ${JSON.stringify(v).slice(0, 80)} — заключите строку с «: » в кавычки`);
  }
  return String(v ?? "");
}

function normalizeQuiz(raw: unknown, taskId: string): QuizQuestion[] {
  const list = asArray(raw as Record<string, unknown>[]);
  return list.map((q, i) => {
    const answerRaw = q.answer as number | number[];
    const answer = asArray(answerRaw).map(Number);
    return {
      id: String(q.id ?? `${taskId}-q${i + 1}`),
      q: String(q.q ?? ""),
      code: q.code ? String(q.code) : undefined,
      options: asArray(q.options as string[]).map((o) => asText(o, `${taskId}: вариант ответа`)),
      answer,
      multiple: Boolean(q.multiple ?? (Array.isArray(answerRaw) && answer.length > 1)),
      ordered: Boolean(q.ordered),
      explain: q.explain ? String(q.explain) : undefined,
    };
  });
}

function normalizeTask(raw: Record<string, unknown>, file: string): TaskSource {
  const id = String(raw.id ?? "");
  if (!id) throw new Error(`Задание без id в ${file}`);
  const kind = (raw.kind as TaskSource["kind"]) ?? "code";
  return {
    id,
    title: String(raw.title ?? id),
    kind,
    difficulty: (raw.difficulty as TaskSource["difficulty"]) ?? "main",
    introduces: asArray(raw.introduces as string[]),
    uses: asArray(raw.uses as string[]),
    statement: String(raw.statement ?? ""),
    prelude: raw.prelude ? String(raw.prelude).replace(/\s+$/, "") : undefined,
    preludeNote: raw.preludeNote ? String(raw.preludeNote) : undefined,
    starter: raw.starter !== undefined ? String(raw.starter).replace(/\s+$/, "") + "\n" : undefined,
    solution: raw.solution ? String(raw.solution).replace(/\s+$/, "") + "\n" : undefined,
    explanation: raw.explanation ? String(raw.explanation) : undefined,
    tests: raw.tests ? String(raw.tests) : undefined,
    files: asArray(raw.files as string[]),
    columns: raw.columns === false ? false : Array.isArray(raw.columns) ? raw.columns.map(String) : undefined,
    timeout: raw.timeout ? Number(raw.timeout) : undefined,
    wrong: asArray(raw.wrong as { code: string; expect: string; note?: string }[]).map((w) => ({
      code: String(w.code ?? ""),
      expect: String(w.expect ?? ""),
      note: w.note ? String(w.note) : undefined,
    })),
    alternatives: asArray(raw.alternatives as string[]).map(String),
    quiz: kind === "quiz" || kind === "predict" ? normalizeQuiz(raw.quiz, id) : undefined,
    hints: asArray(raw.hints as string[]).map((h) => asText(h, `${String(raw.id)}: подсказка`)),
  };
}

function loadLesson(moduleSlug: string, moduleNumber: number | string, dir: string, index: number, single = false): LessonSource {
  const slug = path.basename(dir);
  const file = path.join(dir, "lesson.md");
  const { fm, body } = splitFrontmatter(fs.readFileSync(file, "utf8"), file);
  const tasksFile = path.join(dir, "tasks.yaml");
  let tasks: TaskSource[] = [];
  if (fs.existsSync(tasksFile)) {
    const raw = readYaml<Record<string, unknown>[] | null>(tasksFile) ?? [];
    tasks = raw.map((t) => normalizeTask(t, tasksFile));
  }
  return {
    id: String(fm.id),
    title: String(fm.title),
    type: fm.type ?? "theory",
    duration: Number(fm.duration ?? 10),
    optional: Boolean(fm.optional),
    sources: asArray(fm.sources),
    introduces: asArray(fm.introduces),
    uses: asArray(fm.uses),
    setup: fm.setup ? String(fm.setup).replace(/\s+$/, "") : "",
    files: asArray(fm.files),
    summary: String(fm.summary ?? ""),
    skipTest: Boolean(fm.skipTest),
    slug,
    moduleSlug,
    dir,
    // у контрольной точки из одного урока номер — сам префикс («КТ1»)
    number: single ? String(moduleNumber) : `${moduleNumber}.${index}`,
    index,
    body,
    tasks,
  };
}

function loadModule(dir: string): ModuleSource {
  const slug = path.basename(dir);
  const meta = readYaml<Record<string, unknown>>(path.join(dir, "module.yaml"));
  const number = Number(meta.number ?? 0);
  const firstLessonIndex = Number(meta.firstLessonIndex ?? 1);
  const lessonDirs = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, "lesson.md")))
    .map((d) => d.name)
    .sort();
  // номер урока берём из имени папки (l05-masks → 5), чтобы он не менялся при добавлении уроков
  // префикс номера уроков: у учебных модулей — номер модуля, у контрольных точек — например, «КТ1»
  const prefix = meta.lessonPrefix ? String(meta.lessonPrefix) : number;
  const lessons = lessonDirs.map((name, i) => {
    const m = /^l(\d+)/.exec(name);
    const idx = m ? Number(m[1]) : i + firstLessonIndex;
    return loadLesson(slug, prefix, path.join(dir, name), idx, Boolean(meta.lessonPrefix) && lessonDirs.length === 1);
  });
  const kind = (meta.kind as ModuleSource["kind"]) ?? "module";
  return {
    id: String(meta.id),
    slug,
    number,
    label: String(meta.label ?? `Модуль ${number}`),
    title: String(meta.title),
    short: String(meta.short ?? meta.title),
    description: String(meta.description ?? ""),
    bonus: kind === "bonus",
    kind,
    sources: asArray(meta.sources as string[]),
    warmupReviews: asArray(meta.warmupReviews as string[]),
    lessons,
  };
}

export function loadCourse(force = false): Course {
  // в режиме разработки читаем контент заново, чтобы правки уроков были видны без перезапуска сервера
  if (cache && !force && process.env.NODE_ENV === "production") return cache;
  const meta = readYaml<{ title: string }>(path.join(CONTENT_DIR, "course.yaml"));
  const moduleDirs = fs
    .readdirSync(CONTENT_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(CONTENT_DIR, d.name, "module.yaml")))
    .map((d) => d.name)
    .sort();
  const modules = moduleDirs.map((name) => loadModule(path.join(CONTENT_DIR, name)));
  const concepts = readYaml<Concept[]>(path.join(CONTENT_DIR, "concepts.yaml")) ?? [];
  const glossaryDir = path.join(CONTENT_DIR, "glossary");
  let glossary: GlossaryEntry[] = [];
  if (fs.existsSync(glossaryDir)) {
    for (const f of fs.readdirSync(glossaryDir).filter((x) => x.endsWith(".yaml")).sort()) {
      glossary = glossary.concat(readYaml<GlossaryEntry[]>(path.join(glossaryDir, f)) ?? []);
    }
  }
  cache = { title: meta.title, modules, concepts, glossary };
  return cache;
}

export function lessonHref(moduleSlug: string, lessonSlug: string) {
  return `/learn/${moduleSlug}/${lessonSlug}`;
}

export function findLesson(moduleSlug: string, lessonSlug: string) {
  const course = loadCourse();
  const mod = course.modules.find((m) => m.slug === moduleSlug);
  if (!mod) return null;
  const idx = mod.lessons.findIndex((l) => l.slug === lessonSlug);
  if (idx < 0) return null;
  // плоский список уроков для навигации «назад / дальше»
  const flat = course.modules.flatMap((m) => m.lessons.map((l) => ({ m, l })));
  const pos = flat.findIndex((x) => x.m.slug === moduleSlug && x.l.slug === lessonSlug);
  return {
    course,
    module: mod,
    lesson: mod.lessons[idx],
    prev: pos > 0 ? flat[pos - 1] : null,
    next: pos < flat.length - 1 ? flat[pos + 1] : null,
  };
}

export function conceptMap(course: Course) {
  const map = new Map<string, Concept>();
  for (const c of course.concepts) map.set(c.id, c);
  return map;
}

/** Где вводится каждое понятие: id понятия → урок/модуль. */
export function conceptIntroductions(course: Course) {
  const res = new Map<string, { module: ModuleSource; lesson: LessonSource; order: number }>();
  let order = 0;
  for (const m of course.modules) {
    for (const l of m.lessons) {
      const ids = new Set<string>([...l.introduces, ...l.tasks.flatMap((t) => t.introduces)]);
      for (const id of ids) {
        if (!res.has(id)) res.set(id, { module: m, lesson: l, order });
      }
      order++;
    }
  }
  return res;
}

export function buildCourseIndex(course: Course): CourseIndex {
  const modules = course.modules.map((m) => ({
    id: m.id,
    slug: m.slug,
    number: m.number,
    label: m.label,
    title: m.title,
    short: m.short,
    description: m.description,
    kind: m.kind,
    lessons: m.lessons.map((l) => ({
      id: l.id,
      title: l.title,
      number: l.number,
      type: l.type,
      optional: l.optional,
      duration: l.duration,
      href: lessonHref(m.slug, l.slug),
      taskIds: l.tasks.map((t) => t.id),
      requiredTaskIds: l.tasks.filter((t) => t.difficulty !== "star").map((t) => t.id),
      hasQuiz: /```quiz/.test(l.body),
      examples: (l.body.match(/```(python|py)(?![^\n]*\bnorun\b)[^\n]*\n/g) ?? []).length,
    })),
  }));
  const tasks = course.modules.flatMap((m) =>
    m.lessons.flatMap((l) =>
      l.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        kind: t.kind,
        difficulty: t.difficulty,
        lessonId: l.id,
        moduleId: m.id,
        href: `${lessonHref(m.slug, l.slug)}#${t.id}`,
      }))
    )
  );
  return { modules, tasks };
}
