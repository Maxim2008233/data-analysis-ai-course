/*
 * Проверка всего контента курса.
 *   npm run validate                — статика + запуск всех примеров и заданий в Pyodide (как в браузере)
 *   npm run validate -- --static    — только статические правила
 *   npm run validate -- --module m1 — один модуль;  --lesson m1-l5 — один урок
 *
 * Статические правила (раздел 7.1 ТЗ и правила нагрузки на память, раздел 4):
 *   • у теоретического урока есть разделы «Зачем это нужно», «Типичные ошибки», «Мини-квиз» (2–4 вопроса),
 *     «Что запомнить» (3–5 пунктов) и 2–5 запускаемых примеров;
 *   • теоретический урок вводит 1–3 понятия; разминка/проект/контрольная — ни одного;
 *   • у задания: условие, ровно 3 подсказки, решение и тесты (для кода), introduces ⊆ понятия урока;
 *   • в uses ≤ 3 понятий (без базового Python), все введены раньше, из текущего или 1–2 предыдущих модулей
 *     либо повторены в разминке модуля (warmupReviews);
 *   • датасеты, SVG-схемы и внутренние ссылки существуют; id уникальны; статьи справочника существуют.
 * Динамические:
 *   • все примеры теории урока выполняются по порядку без ошибок (и без предупреждений);
 *   • эталон проходит тесты; заготовка — нет; неверные решения не проходят и дают ожидаемое сообщение;
 *     альтернативные верные решения проходят;
 *   • соревнования (блок ```competition id```): заготовка собирает корректную таблицу прогнозов и даёт на скрытых
 *     ответах ровно baseline из реестра; эталон из private/competitions/<id>/reference_solution.py обгоняет baseline.
 */
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { conceptIntroductions, loadCourse, lessonHref } from "../src/lib/content/load";
import type { Course, LessonSource, ModuleSource, TaskSource } from "../src/lib/content/types";
import { formatScore, getCompetition, isBetter, type CompetitionConfig } from "../src/lib/competitions/registry";
import { scoreAccuracy, scoreChoices, scorePredictions, validateChoices, validateLabels, validateSubmission } from "../src/lib/competitions/scoring";

type Level = "error" | "warn";
interface Issue {
  level: Level;
  where: string;
  msg: string;
}

const args = process.argv.slice(2);
const STATIC_ONLY = args.includes("--static");
const argVal = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const ONLY_MODULE = argVal("--module");
const ONLY_LESSON = argVal("--lesson");
const ROOT = process.cwd();
const issues: Issue[] = [];
const err = (where: string, msg: string) => issues.push({ level: "error", where, msg });
const warn = (where: string, msg: string) => issues.push({ level: "warn", where, msg });

function stripCode(md: string): string {
  return md.replace(/```[\s\S]*?```/g, "");
}

function headings(md: string): string[] {
  return stripCode(md)
    .split("\n")
    .filter((l) => /^##\s/.test(l))
    .map((l) => l.replace(/^##\s+/, "").trim());
}

function sectionText(md: string, title: string): string {
  const lines = md.split("\n");
  let inCode = false;
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) inCode = !inCode;
    if (inCode) continue;
    if (/^##\s/.test(lines[i])) {
      if (start >= 0) {
        end = i;
        break;
      }
      if (lines[i].replace(/^##\s+/, "").trim() === title) start = i + 1;
    }
  }
  return start >= 0 ? lines.slice(start, end).join("\n") : "";
}

function runnableBlocks(md: string): { code: string; expectError: boolean; expectWarning: boolean }[] {
  const res: { code: string; expectError: boolean; expectWarning: boolean }[] = [];
  const re = /```(\w+)([^\n]*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) {
    const lang = m[1].toLowerCase();
    if ((lang === "python" || lang === "py") && !/\bnorun\b/.test(m[2])) res.push({ code: m[3], expectError: /\bexpect-error\b/.test(m[2]), expectWarning: /\bexpect-warning\b/.test(m[2]) });
  }
  return res;
}

function competitionBlocks(md: string): { id: string; code: string }[] {
  const res: { id: string; code: string }[] = [];
  const re = /```competition([^\n]*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) res.push({ id: m[1].trim(), code: m[2] });
  return res;
}

function quizBlocks(md: string): unknown[][] {
  const res: unknown[][] = [];
  const re = /```quiz\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) {
    try {
      const v = YAML.parse(m[1]);
      res.push(Array.isArray(v) ? v : [v]);
    } catch {
      res.push([]);
    }
  }
  return res;
}

function checkQuizQuestions(where: string, qs: unknown[]) {
  qs.forEach((raw, i) => {
    const q = raw as { q?: string; options?: unknown[]; answer?: number | number[] };
    if (!q.q) err(where, `вопрос ${i + 1}: нет текста (q)`);
    const n = Array.isArray(q.options) ? q.options.length : 0;
    if (n < 2) err(where, `вопрос ${i + 1}: меньше двух вариантов ответа`);
    const ans = Array.isArray(q.answer) ? q.answer : [q.answer];
    if (!ans.length || ans.some((a) => typeof a !== "number" || a < 0 || a >= n)) err(where, `вопрос ${i + 1}: неверный индекс ответа ${JSON.stringify(q.answer)}`);
  });
}

function knownRoutes(course: Course): Set<string> {
  const s = new Set(["/", "/courses", "/course", "/tasks", "/reference", "/profile", "/login", "/register", "/forgot-password", "/reset-password", "/about"]);
  for (const m of course.modules) {
    s.add(`/course/${m.slug}`);
    for (const l of m.lessons) s.add(lessonHref(m.slug, l.slug));
  }
  return s;
}

function staticChecks(course: Course) {
  const conceptIds = new Map(course.concepts.map((c) => [c.id, c]));
  const glossaryIds = new Set(course.glossary.map((g) => g.id));
  const intro = conceptIntroductions(course);
  const routes = knownRoutes(course);
  const lessonIds = new Set<string>();
  const taskIds = new Set<string>();
  const introducedBy = new Map<string, string[]>();
  // «давность» понятия считаем по учебным модулям: контрольные точки и соревнования не сдвигают расстояние
  const moduleIndex = new Map<string, number>();
  let contentIdx = -1;
  for (const m of course.modules) {
    if (m.kind === "module" || m.kind === "bonus") contentIdx++;
    moduleIndex.set(m.id, Math.max(contentIdx, 0));
  }
  let order = 0;
  const lessonOrder = new Map<string, number>();
  for (const m of course.modules) for (const l of m.lessons) lessonOrder.set(l.id, order++);

  // справочник
  for (const c of course.concepts) {
    for (const g of c.glossary ?? []) if (!glossaryIds.has(g)) err(`concepts.yaml:${c.id}`, `нет статьи справочника «${g}»`);
    if (!c.recall) err(`concepts.yaml:${c.id}`, "нет текста recall для карточки «Вспомним»");
  }
  const seenG = new Set<string>();
  for (const g of course.glossary) {
    if (seenG.has(g.id)) err(`glossary:${g.id}`, "повторяющийся id");
    seenG.add(g.id);
    for (const lid of g.lessons ?? []) if (!lessonOrder.has(lid)) err(`glossary:${g.id}`, `ссылка на несуществующий урок ${lid}`);
    if (!g.summary) err(`glossary:${g.id}`, "нет описания (summary)");
  }

  for (const m of course.modules) {
    const mi = moduleIndex.get(m.id)!;
    for (const l of m.lessons) {
      const where = `${m.slug}/${l.slug}`;
      if (lessonIds.has(l.id)) err(where, `повторяющийся id урока ${l.id}`);
      lessonIds.add(l.id);
      const isTheory = l.type === "theory";
      // разделы теории
      const hs = headings(l.body);
      const need = isTheory ? ["Зачем это нужно", "Типичные ошибки", "Мини-квиз", "Что запомнить"] : ["Зачем это нужно"];
      for (const h of need) if (!hs.includes(h)) err(where, `нет раздела «## ${h}»`);
      const examples = runnableBlocks(l.body);
      if (isTheory && (examples.length < 2 || examples.length > 6)) err(where, `запускаемых примеров ${examples.length}, нужно 2–5`);
      for (const cb of competitionBlocks(l.body)) {
        const comp = getCompetition(cb.id);
        if (!comp) err(where, `блок competition: неизвестное соревнование «${cb.id}» (см. src/lib/competitions/registry.ts)`);
        else {
          if (m.kind !== "competition") err(where, "блок competition допустим только в части курса kind: competition");
          for (const f of comp.files) if (!fs.existsSync(path.join(ROOT, "public/data", f))) err(where, `соревнование ${cb.id}: нет файла public/data/${f}`);
          if (!fs.existsSync(path.join(ROOT, "private/competitions", cb.id, "answers.json"))) err(where, `соревнование ${cb.id}: нет private/competitions/${cb.id}/answers.json`);
          if (!/\bsubmission\s*=/.test(cb.code)) err(where, `соревнование ${cb.id}: заготовка не создаёт таблицу submission`);
        }
      }
      const quizzes = quizBlocks(l.body);
      if (isTheory) {
        const qn = quizzes.reduce((n, q) => n + q.length, 0);
        if (qn < 2 || qn > 4) err(where, `в мини-квизе ${qn} вопросов, нужно 2–4`);
        if (!sectionText(l.body, "Мини-квиз").includes("```quiz")) err(where, "в разделе «Мини-квиз» нет блока ```quiz");
        const remember = sectionText(l.body, "Что запомнить")
          .split("\n")
          .filter((x) => /^\s*[-*]\s/.test(x)).length;
        if (remember < 3 || remember > 5) err(where, `в «Что запомнить» ${remember} пунктов, нужно 3–5`);
      }
      quizzes.forEach((q, i) => checkQuizQuestions(`${where} (квиз ${i + 1})`, q));
      // понятия урока
      if (isTheory && (l.introduces.length < 1 || l.introduces.length > 3)) err(where, `урок вводит ${l.introduces.length} понятий, нужно 1–3`);
      if (!isTheory && l.introduces.length > 0) err(where, `урок типа ${l.type} не должен вводить новые понятия`);
      for (const c of l.introduces) {
        if (!conceptIds.has(c)) err(where, `понятие «${c}» не описано в concepts.yaml`);
        introducedBy.set(c, [...(introducedBy.get(c) ?? []), l.id]);
      }
      // файлы
      for (const f of l.files) if (!fs.existsSync(path.join(ROOT, "public/data", f))) err(where, `нет датасета public/data/${f}`);
      // SVG и ссылки
      for (const mm of l.body.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const url = mm[1];
        if (!/^https?:/.test(url) && !fs.existsSync(path.join(l.dir, url))) err(where, `нет файла схемы ${url}`);
      }
      const allMd = [l.body, ...l.tasks.flatMap((t) => [t.statement, ...t.hints, t.explanation ?? ""])].join("\n");
      for (const mm of allMd.matchAll(/\]\((\/[^)\s#]*)(#[^)\s]*)?\)/g)) {
        if (!routes.has(mm[1].replace(/\/$/, "") || "/")) err(where, `битая внутренняя ссылка ${mm[1]}`);
      }
      // задания
      if (isTheory && l.tasks.length && (l.tasks.length < 3 || l.tasks.length > 6)) warn(where, `заданий ${l.tasks.length}, рекомендуется 3–6`);
      if (isTheory && !l.tasks.length) warn(where, "в уроке нет заданий");
      for (const t of l.tasks) checkTask(m, mi, l, t, where, { conceptIds, intro, moduleIndex, lessonOrder, taskIds });
    }
  }
  for (const [c, ls] of introducedBy) if (ls.length > 1) err("concepts", `понятие «${c}» вводится несколько раз: ${ls.join(", ")}`);
}

function checkTask(
  m: ModuleSource,
  mi: number,
  l: LessonSource,
  t: TaskSource,
  lessonWhere: string,
  ctx: {
    conceptIds: Map<string, { foundation?: boolean }>;
    intro: ReturnType<typeof conceptIntroductions>;
    moduleIndex: Map<string, number>;
    lessonOrder: Map<string, number>;
    taskIds: Set<string>;
  }
) {
  const where = `${lessonWhere} · ${t.id}`;
  if (ctx.taskIds.has(t.id)) err(where, "повторяющийся id задания");
  ctx.taskIds.add(t.id);
  if (!t.statement.trim()) err(where, "нет формулировки");
  if (t.hints.length !== 3) err(where, `подсказок ${t.hints.length}, нужно ровно 3`);
  const isQuiz = t.kind === "quiz" || t.kind === "predict";
  if (isQuiz) {
    if (!t.quiz?.length) err(where, "у квиза нет вопросов");
    else
      checkQuizQuestions(
        where,
        t.quiz.map((q) => ({ q: q.q, options: q.options, answer: q.answer }))
      );
  } else {
    if (!t.solution?.trim()) err(where, "нет эталонного решения");
    if (!t.tests?.trim()) err(where, "нет тестов");
    if (t.starter === undefined) err(where, "нет стартового кода");
    if (!t.explanation?.trim()) warn(where, "нет построчного пояснения решения (explanation)");
    for (const f of t.files ?? []) if (!fs.existsSync(path.join(ROOT, "public/data", f))) err(where, `нет датасета public/data/${f}`);
  }
  // понятия
  for (const c of t.introduces) {
    if (!l.introduces.includes(c)) err(where, `introduces «${c}» не входит в понятия урока (${l.introduces.join(", ") || "—"})`);
  }
  const nonFoundation = t.uses.filter((c) => !ctx.conceptIds.get(c)?.foundation);
  if (nonFoundation.length > 3) err(where, `в uses ${nonFoundation.length} прошлых понятий (без базового Python), допускается ≤ 3`);
  const myOrder = ctx.lessonOrder.get(l.id)!;
  for (const c of t.uses) {
    const def = ctx.conceptIds.get(c);
    if (!def) {
      err(where, `uses: понятие «${c}» не описано в concepts.yaml`);
      continue;
    }
    if (t.introduces.includes(c)) err(where, `понятие «${c}» одновременно в introduces и uses`);
    const where0 = ctx.intro.get(c);
    if (!where0) {
      if (!def.foundation) err(where, `uses: понятие «${c}» нигде не вводится`);
      continue;
    }
    // базовый Python — фундамент: уроки «Минимум Python» необязательны, порядок для них не проверяем
    if (def.foundation) continue;
    const introOrder = ctx.lessonOrder.get(where0.lesson.id)!;
    if (introOrder > myOrder) err(where, `uses: понятие «${c}» вводится позже (урок ${where0.lesson.number})`);
    const ci = ctx.moduleIndex.get(where0.module.id)!;
    if (mi - ci > 2 && !m.warmupReviews.includes(c)) {
      err(where, `uses: понятие «${c}» из давнего модуля (${where0.module.label}); повторите его в разминке модуля (warmupReviews) или уберите`);
    }
  }
}

// ---------------- динамические проверки ----------------
interface TaskReport {
  id: string;
  ok: boolean;
  ms: number;
  details: string[];
}

type Execute = (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;

type CompetitionAnswers =
  | { ids: number[]; prices: number[] }
  | { ids: string[]; classes: string[] }
  | { ids: number[]; scored: number[]; answers: number[] };

/** Решение соревнования → таблица ответов → метрика на скрытых ответах (локально, как на сервере). */
async function competitionScore(execute: Execute, comp: CompetitionConfig, code: string, answers: CompetitionAnswers) {
  const res = (await execute({
    mode: "submission",
    ns: `validate:comp:${comp.id}`,
    reset: true,
    setup: "",
    files: comp.files,
    code,
    competition: {
      idColumn: comp.idColumn,
      predictionColumn: comp.predictionColumn,
      testFile: comp.testFile,
      range: comp.predictionRange,
      idType: comp.idType,
      predictionType: comp.predictionType,
      labels: comp.labels ?? null,
      objectForms: comp.objectForms,
    },
  })) as { ok: boolean; message: string; error: { title: string; message: string } | null; submission: { ids: (number | string)[]; predictions: (number | string)[] } | null };
  if (!res.ok || !res.submission) return { ok: false as const, message: res.message || `${res.error?.title}: ${res.error?.message}` };
  if ("scored" in answers) {
    const checked = validateChoices(res.submission, answers.ids);
    if (!checked.ok) return { ok: false as const, message: `сервер не принял бы ответы: ${checked.error}` };
    const s = scoreChoices(answers.ids, checked.predictions, answers.scored, answers.answers);
    return { ok: true as const, score: Math.round(s.accuracy * 1e4) / 1e4, second: s.correct };
  }
  if ("classes" in answers) {
    const checked = validateLabels(res.submission, answers.ids, comp.labels ?? []);
    if (!checked.ok) return { ok: false as const, message: `сервер не принял бы ответы: ${checked.error}` };
    const s = scoreAccuracy(answers.classes, checked.labels);
    return { ok: true as const, score: Math.round(s.accuracy * 1e4) / 1e4, second: s.correct };
  }
  const checked = validateSubmission(res.submission, answers.ids, comp.predictionRange);
  if (!checked.ok) return { ok: false as const, message: `сервер не принял бы прогнозы: ${checked.error}` };
  const s = scorePredictions(answers.prices, checked.predictions);
  return { ok: true as const, score: s.mae, second: s.medianAe };
}

async function checkCompetition(execute: Execute, where: string, comp: CompetitionConfig, starter: string) {
  const started = Date.now();
  const answersFile = path.join(ROOT, "private/competitions", comp.id, "answers.json");
  if (!fs.existsSync(answersFile)) return; // ошибка уже записана статической проверкой
  const answers = JSON.parse(fs.readFileSync(answersFile, "utf8")) as CompetitionAnswers;
  const tw = `${where} · соревнование ${comp.id}`;
  const details: string[] = [];
  const label = comp.metricLabel;
  // допуск: MAE и медиана округляются сервером до целых, доля верных — до 4 знаков
  const tol = comp.metric === "accuracy" ? { score: 5e-5, second: 0 } : { score: 1, second: 1 };
  let ok = true;
  const base = await competitionScore(execute, comp, starter, answers);
  if (!base.ok) {
    ok = false;
    err(tw, `заготовка (baseline) не собирает ответы: ${base.message}`);
  } else if (Math.abs(base.score - comp.baseline.score) > tol.score || Math.abs(base.second - comp.baseline.second) > tol.second) {
    ok = false;
    err(tw, `baseline в реестре (${label} ${comp.baseline.score}, второе число ${comp.baseline.second}) не совпадает с расчётом: ${base.score}, ${base.second}`);
  } else details.push(`baseline ${label} ${formatScore(comp, base.score)} = реестр`);
  const refFile = path.join(ROOT, "private/competitions", comp.id, "reference_solution.py");
  if (!fs.existsSync(refFile)) warn(tw, "нет эталонного решения private/competitions/<id>/reference_solution.py");
  else {
    const strong = await competitionScore(execute, comp, fs.readFileSync(refFile, "utf8"), answers);
    if (!strong.ok) {
      ok = false;
      err(tw, `эталонное решение не собирает ответы: ${strong.message}`);
    } else if (!isBetter(comp, strong.score, comp.baseline.score)) {
      ok = false;
      err(tw, `эталонное решение не обгоняет baseline: ${label} ${formatScore(comp, strong.score)}`);
    } else details.push(`эталон ${label} ${formatScore(comp, strong.score)}`);
  }
  process.stdout.write(`${ok ? "✓" : "✗"} competition ${comp.id} (${Date.now() - started} мс) ${details.join(", ")}\n`);
}

async function dynamicChecks(course: Course) {
  const { createNodeEngine } = await import("./lib/node-engine.mjs");
  const t0 = Date.now();
  let engine = await createNodeEngine({ strict: true });
  let execute = engine.execute;
  console.log(`Pyodide готов за ${Date.now() - t0} мс`);
  // Память wasm-движка только растёт. За прогон всего курса в одном движке Pyodide дважды вернул испорченную
  // строку вместо ответа (JSON.parse упал на уроках 8.7 и Б.1). Поэтому пространство имён примеров урока
  // освобождается сразу после них, а если память всё же перешла порог, движок создаётся заново.
  const ENGINE_MEMORY_LIMIT = Number(process.env.VALIDATE_ENGINE_LIMIT_MB ?? 1536) * 2 ** 20; // порог в МБ можно задать для проверки
  const engineMemory = (): number => engine.engine.memoryBytes() ?? 0;
  const mb = (bytes: number) => Math.round(bytes / 2 ** 20);
  const guardMemory = async () => {
    const used = engineMemory();
    if (used <= ENGINE_MEMORY_LIMIT) return;
    engine = await createNodeEngine({ strict: true });
    execute = engine.execute;
    console.log(`· движок Pyodide создан заново: память дошла до ${mb(used)} МБ`);
  };
  const reports: TaskReport[] = [];
  let examplesRun = 0;
  for (const m of course.modules) {
    for (const l of m.lessons) {
      if (ONLY_LESSON && l.id !== ONLY_LESSON) continue;
      const where = `${m.slug}/${l.slug}`;
      // примеры теории — по порядку в общем пространстве имён
      const examples = runnableBlocks(l.body);
      const ns = `validate:${l.id}`;
      for (let i = 0; i < examples.length; i++) {
        const res = await execute({ mode: "run", ns, setup: l.setup, files: l.files, code: examples[i].code, reset: i === 0 });
        examplesRun++;
        if (examples[i].expectError) {
          if (res.ok) err(where, `пример ${i + 1} помечен expect-error, но выполнился без ошибки`);
          continue;
        }
        if (!res.ok) err(where, `пример ${i + 1} завершился ошибкой: ${res.error?.title} — ${res.error?.message}`);
        const warnText = res.outputs.filter((o: { type: string; stream?: string }) => o.type === "text" && o.stream === "stderr").map((o: { text: string }) => o.text).join(" ");
        if (examples[i].expectWarning) {
          if (!warnText.trim()) err(where, `пример ${i + 1} помечен expect-warning, но предупреждения нет`);
        } else if (warnText.trim()) warn(where, `пример ${i + 1} выводит предупреждения: ${warnText.slice(0, 300)}`);
      }
      if (examples.length) await execute({ mode: "reset", ns });
      for (const cb of competitionBlocks(l.body)) {
        const comp = getCompetition(cb.id);
        if (!comp) continue;
        await checkCompetition(execute, where, comp, cb.code);
      }
      for (const t of l.tasks) {
        if (t.kind === "quiz" || t.kind === "predict") continue;
        const tw = `${where} · ${t.id}`;
        const started = Date.now();
        const details: string[] = [];
        let ok = true;
        const base = { mode: "check", prelude: t.prelude ?? "", solution: t.solution ?? "", tests: t.tests ?? "", files: t.files?.length ? t.files : l.files };
        const sol = await execute({ ...base, code: t.solution });
        if (!sol.passed) {
          ok = false;
          err(tw, `эталонное решение НЕ проходит тесты: ${sol.message}`);
        } else details.push("эталон ✓");
        const solWarn = sol.outputs?.filter((o: { type: string; stream?: string }) => o.type === "text" && o.stream === "stderr").map((o: { text: string }) => o.text).join(" ");
        if (solWarn?.trim()) warn(tw, `эталон выводит предупреждения: ${solWarn.slice(0, 300)}`);
        const st = await execute({ ...base, code: t.starter ?? "" });
        if (st.passed) {
          ok = false;
          err(tw, "стартовый код проходит тесты — задание решается без изменений");
        } else details.push(`заготовка ✗ («${st.message.slice(0, 80)}»)`);
        for (const [i, w] of (t.wrong ?? []).entries()) {
          const r = await execute({ ...base, code: w.code });
          if (r.passed) {
            ok = false;
            err(tw, `неверное решение ${i + 1} проходит тесты`);
          } else if (w.expect && !r.message.includes(w.expect)) {
            ok = false;
            err(tw, `неверное решение ${i + 1}: сообщение «${r.message}» не содержит «${w.expect}»`);
          } else details.push(`неверное ${i + 1} ✗`);
          if (r.kind === "internal") {
            ok = false;
            err(tw, `неверное решение ${i + 1} вызвало внутреннюю ошибку проверки: ${r.message}`);
          }
        }
        for (const [i, a] of (t.alternatives ?? []).entries()) {
          const r = await execute({ ...base, code: a });
          if (!r.passed) {
            ok = false;
            err(tw, `альтернативное верное решение ${i + 1} не проходит: ${r.message}`);
          } else details.push(`альтернатива ${i + 1} ✓`);
        }
        if (!(t.wrong ?? []).length) warn(tw, "нет ни одного типичного неверного решения (wrong)");
        const ms = Date.now() - started;
        if (ms > 20000) warn(tw, `проверка задания заняла ${Math.round(ms / 1000)} с`);
        reports.push({ id: t.id, ok, ms, details });
        process.stdout.write(`${ok ? "✓" : "✗"} ${t.id} (${ms} мс) ${details.join(", ")}\n`);
        await guardMemory(); // тяжёлые задания (леса, сети) поднимают память на сотни мегабайт
      }
      await guardMemory();
    }
    if (!ONLY_LESSON) console.log(`· ${m.id}: память движка Pyodide ${mb(engineMemory())} МБ`);
  }
  return { reports, examplesRun };
}

async function main() {
  const full = loadCourse();
  const course: Course = {
    ...full,
    modules: full.modules
      .filter((m) => !ONLY_MODULE || m.id === ONLY_MODULE)
      .map((m) => ({ ...m, lessons: m.lessons.filter((l) => !ONLY_LESSON || l.id === ONLY_LESSON) })),
  };
  // статические проверки всегда по всему курсу (порядок понятий зависит от предыдущих модулей)
  staticChecks(full);
  const filtered = issues.filter((i) => {
    if (!ONLY_MODULE && !ONLY_LESSON) return true;
    const mod = course.modules.map((m) => m.slug);
    return mod.some((s) => i.where.startsWith(s)) || i.where.startsWith("concepts") || i.where.startsWith("glossary");
  });
  issues.length = 0;
  issues.push(...filtered);
  let dyn: Awaited<ReturnType<typeof dynamicChecks>> | null = null;
  if (!STATIC_ONLY) dyn = await dynamicChecks(course);

  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warn");
  for (const i of warnings) console.log(`⚠ ${i.where}: ${i.msg}`);
  for (const i of errors) console.log(`✗ ${i.where}: ${i.msg}`);
  const lessons = course.modules.reduce((n, m) => n + m.lessons.length, 0);
  const tasks = course.modules.reduce((n, m) => n + m.lessons.reduce((k, l) => k + l.tasks.length, 0), 0);
  const summary = {
    date: new Date().toISOString(),
    modules: course.modules.length,
    lessons,
    tasks,
    examplesRun: dyn?.examplesRun ?? 0,
    codeTasksChecked: dyn?.reports.length ?? 0,
    codeTasksOk: dyn?.reports.filter((r) => r.ok).length ?? 0,
    errors: errors.length,
    warnings: warnings.length,
  };
  fs.mkdirSync(path.join(ROOT, "reports"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "reports/content-report.json"), JSON.stringify({ summary, issues, tasks: dyn?.reports ?? [] }, null, 2));
  console.log("\nИтог:", JSON.stringify(summary));
  process.exit(errors.length ? 1 : 0);
}

void main();
