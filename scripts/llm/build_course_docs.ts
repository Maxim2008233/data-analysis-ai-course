/**
 * Данные модуля 11: «база знаний» для поиска по документам и RAG — разделы уроков самого курса.
 *
 *   public/data/course_docs.json   — разделы теоретических уроков модулей 0–10: номер урока, заголовок раздела, текст
 *                                    без кода, формул и разметки (ровно то, что читает ученик);
 *   public/data/course_queries.json — вопросы для проверки поиска: название статьи справочника и номер урока,
 *                                    где это понятие вводится (по метаданным introduces);
 *   public/data/course_glossary.json — статьи справочника курса: название, синонимы, краткое описание.
 *
 * Тексты — наши собственные уроки, поэтому их можно класть на сайт. Запуск: npx tsx scripts/llm/build_course_docs.ts
 */
import fs from "node:fs";
import path from "node:path";
import { conceptIntroductions, loadCourse } from "../../src/lib/content/load";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public", "data");
const MAX_MODULE = 10; // база знаний — модули 0–10: модуль 11 сам по ней ищет
const SKIP = new Set(["Мини-квиз"]);

function clean(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ") // блоки кода и квизы
    .replace(/\$\$[\s\S]*?\$\$/g, " ") // формулы
    .replace(/:::mistake\s*/g, "")
    .replace(/:::/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // картинки
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // ссылки → текст
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^\s*\|.*\|\s*$/gm, " ") // таблицы
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

const course = loadCourse(true);
const docs: { id: string; lesson: string; module: number; lesson_title: string; section: string; text: string }[] = [];
for (const m of course.modules) {
  if (m.kind !== "module" || m.number > MAX_MODULE) continue;
  for (const l of m.lessons) {
    if (l.type !== "theory") continue;
    const parts = l.body.split(/^## /m).slice(1);
    parts.forEach((part, k) => {
      const nl = part.indexOf("\n");
      const section = part.slice(0, nl).trim();
      if (SKIP.has(section)) return;
      const text = clean(part.slice(nl + 1));
      if (text.length < 40) return;
      docs.push({ id: `${l.id}#${k + 1}`, lesson: l.number, module: m.number, lesson_title: l.title, section, text });
    });
  }
}

// вопросы для проверки поиска: статья справочника → урок, где вводится понятие
const intro = conceptIntroductions(course);
const termOf = new Map(course.glossary.map((g) => [g.id, g.term]));
const queries = new Map<string, { term: string; glossary: string; concept: string; lesson: string }>();
for (const c of course.concepts) {
  const where = intro.get(c.id);
  if (!where || where.module.kind !== "module" || where.module.number > MAX_MODULE || where.lesson.type !== "theory") continue;
  for (const g of c.glossary ?? []) {
    if (queries.has(g) || !termOf.has(g)) continue; // статья у нескольких понятий — берём первое введение
    queries.set(g, { term: termOf.get(g)!, glossary: g, concept: c.id, lesson: where.lesson.number });
  }
}

// справочник — статьи понятий модулей 0–10 и общие статьи, не привязанные к понятиям (снимок не меняется с новыми модулями)
const linked = new Map<string, number>();
for (const c of course.concepts) {
  const where = intro.get(c.id);
  const num = where ? where.module.number : 0;
  for (const g of c.glossary ?? []) linked.set(g, Math.min(linked.get(g) ?? Infinity, num));
}
const glossary = course.glossary
  .filter((g) => (linked.get(g.id) ?? 0) <= MAX_MODULE)
  .map((g) => ({ id: g.id, term: g.term, aliases: g.aliases ?? [], summary: clean(g.summary) }));
fs.writeFileSync(path.join(OUT, "course_glossary.json"), JSON.stringify(glossary, null, 0) + "\n");
fs.writeFileSync(path.join(OUT, "course_docs.json"), JSON.stringify(docs, null, 0) + "\n");
fs.writeFileSync(path.join(OUT, "course_queries.json"), JSON.stringify([...queries.values()], null, 1) + "\n");
const size = fs.statSync(path.join(OUT, "course_docs.json")).size;
console.log(`разделов: ${docs.length} (${(size / 1024).toFixed(0)} КБ), уроков: ${new Set(docs.map((d) => d.lesson)).size}, вопросов: ${queries.size}, статей справочника: ${glossary.length}`);
