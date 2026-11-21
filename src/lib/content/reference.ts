// Данные справочника для страницы /reference и выдвижной панели в уроках.
import { conceptIntroductions, lessonHref, loadCourse } from "./load";
import { highlightPython } from "../highlight";
import { mdToHtml } from "./markdown";

export interface ReferenceEntry {
  id: string;
  term: string;
  category: string;
  aliases: string[];
  summaryHtml: string;
  syntaxHtml?: string;
  exampleHtml?: string;
  lessons: { id: string; number: string; title: string; href: string }[];
  searchText: string;
}

export const CATEGORY_ORDER = [
  "Python",
  "NumPy",
  "Pandas",
  "Визуализация",
  "Статистика",
  "Машинное обучение",
  "Scikit-learn",
  "Метрики",
  "Нейросети",
  "LLM и NLP",
  "Агенты",
  "ИИ: общие понятия",
];

export function buildReferenceData(): ReferenceEntry[] {
  const course = loadCourse();
  const lessonsById = new Map<string, { id: string; number: string; title: string; href: string }>();
  for (const m of course.modules)
    for (const l of m.lessons) lessonsById.set(l.id, { id: l.id, number: l.number, title: l.title, href: lessonHref(m.slug, l.slug) });
  // связь «понятие → статья справочника» добавляет урок, где понятие вводится
  const intro = conceptIntroductions(course);
  const extraLessons = new Map<string, Set<string>>();
  for (const c of course.concepts) {
    const where = intro.get(c.id);
    if (!where) continue;
    for (const g of c.glossary ?? []) {
      if (!extraLessons.has(g)) extraLessons.set(g, new Set());
      extraLessons.get(g)!.add(where.lesson.id);
    }
  }
  const entries = course.glossary.map((g) => {
    const lessonIds = new Set<string>([...(g.lessons ?? []), ...(extraLessons.get(g.id) ?? [])]);
    const lessons = Array.from(lessonIds)
      .map((id) => lessonsById.get(id))
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
    const summaryHtml = mdToHtml(g.summary ?? "");
    return {
      id: g.id,
      term: g.term,
      category: g.category,
      aliases: g.aliases ?? [],
      summaryHtml,
      syntaxHtml: g.syntax ? highlightPython(g.syntax.replace(/\s+$/, "")) : undefined,
      exampleHtml: g.example ? highlightPython(g.example.replace(/\s+$/, "")) : undefined,
      lessons,
      searchText: [g.term, ...(g.aliases ?? []), g.category, g.summary, g.syntax ?? ""].join(" ").toLowerCase().replace(/ё/g, "е"),
    };
  });
  const order = (c: string) => {
    const i = CATEGORY_ORDER.indexOf(c);
    return i < 0 ? 99 : i;
  };
  entries.sort((a, b) => order(a.category) - order(b.category) || a.term.localeCompare(b.term, "ru"));
  return entries;
}
