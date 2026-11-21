// Markdown → React (на сервере при сборке). Поддержка: GFM-таблицы, KaTeX, вставка SVG-схем,
// запускаемые примеры (```python), квизы (```quiz), выноски (:::tip, :::warning, :::mistake, ...).
import fs from "node:fs";
import path from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkDirective from "remark-directive";
import remarkRehype from "remark-rehype";
import rehypeKatex from "rehype-katex";
import { toJsxRuntime, type Components } from "hast-util-to-jsx-runtime";
import { toHtml } from "hast-util-to-html";
import { toString as mdToString } from "mdast-util-to-string";
import { visit } from "unist-util-visit";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import YAML from "yaml";
import type { Root as MdRoot, Code, Paragraph, Image, Parent } from "mdast";
import type { Root as HastRoot, Element as HastElement, ElementContent } from "hast";
import type { ReactNode } from "react";
import { highlightPython, escapeHtml } from "../highlight";
import type { QuizQuestion } from "./types";

export interface MdOptions {
  dir?: string; // папка урока (для SVG)
  lessonId?: string;
  runnable?: boolean; // ```python → запускаемый пример
  runOffset?: number; // номер первого запускаемого примера (если урок рендерится по частям-шагам)
  quizOffset?: number; // номер первого квиза
}

const CALLOUTS = ["tip", "warning", "info", "mistake", "recall", "note", "example", "definition", "important"];

type AnyNode = { type: string; data?: Record<string, unknown>; children?: AnyNode[]; [k: string]: unknown };

function normalizeQuizYaml(text: string, quizId: string): QuizQuestion[] {
  const raw = (YAML.parse(text) ?? []) as Record<string, unknown>[];
  return (Array.isArray(raw) ? raw : [raw]).map((q, i) => {
    const a = q.answer as number | number[];
    const answer = (Array.isArray(a) ? a : [a]).map(Number);
    return {
      id: String(q.id ?? `${quizId}-${i + 1}`),
      q: String(q.q ?? ""),
      code: q.code ? String(q.code) : undefined,
      options: ((q.options as string[]) ?? []).map(String),
      answer,
      multiple: Boolean(q.multiple ?? (Array.isArray(a) && answer.length > 1)),
      ordered: Boolean(q.ordered),
      explain: q.explain ? String(q.explain) : undefined,
    };
  });
}

/** id вопросов во всех ```quiz внутри фрагмента урока (те же, что получит рендер с тем же quizOffset). */
export function quizIdsIn(markdown: string, lessonId: string, quizOffset: number): string[] {
  const ids: string[] = [];
  let k = quizOffset;
  for (const m of markdown.matchAll(/```quiz\n([\s\S]*?)```/g)) {
    k++;
    ids.push(...normalizeQuizYaml(m[1], `${lessonId}-quiz${k}`).map((q) => q.id));
  }
  return ids;
}

/** Вопросы квиза для клиента: Markdown заранее превращён в HTML. */
export interface QuizQuestionView {
  id: string;
  qHtml: string;
  codeHtml?: string;
  optionsHtml: string[];
  order: number[]; // порядок показа вариантов (индексы optionsHtml)
  answer: number[];
  multiple: boolean;
  explainHtml?: string;
}

/**
 * Порядок показа вариантов: детерминированное перемешивание по id вопроса (одинаковое при сборке, в браузере
 * и на всех устройствах), чтобы верный ответ не стоял всегда на одном месте. Ответы хранятся в исходных индексах.
 */
export function optionOrder(id: string, n: number, ordered = false): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  if (ordered || n < 2) return order;
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  const rnd = () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

export function quizToView(questions: QuizQuestion[]): QuizQuestionView[] {
  return questions.map((q) => ({
    id: q.id,
    qHtml: mdToHtml(q.q),
    codeHtml: q.code ? highlightPython(q.code.replace(/\s+$/, "")) : undefined,
    optionsHtml: q.options.map((o) => mdInlineToHtml(String(o))),
    order: optionOrder(q.id, q.options.length, q.ordered),
    answer: q.answer,
    multiple: q.multiple,
    explainHtml: q.explain ? mdToHtml(q.explain) : undefined,
  }));
}

function remarkCourse(opts: MdOptions) {
  return (tree: MdRoot) => {
    let runIndex = opts.runOffset ?? 0;
    let quizIndex = opts.quizOffset ?? 0;
    // абзац, состоящий только из SVG-картинки → фигура (блочный элемент, не внутри <p>)
    visit(tree, "paragraph", (node: Paragraph, index, parent: Parent | undefined) => {
      if (!parent || index === undefined) return;
      const kids = node.children.filter((c) => !(c.type === "text" && !c.value.trim()));
      if (kids.length === 1 && kids[0].type === "image") {
        const img = kids[0] as Image;
        if (/\.svg$/i.test(img.url) && !/^https?:/i.test(img.url) && opts.dir) {
          const file = path.join(opts.dir, img.url);
          let svg = "";
          try {
            svg = fs.readFileSync(file, "utf8");
          } catch {
            svg = `<p>[не найдена схема ${escapeHtml(img.url)}]</p>`;
          }
          const fig = node as unknown as AnyNode;
          fig.data = { hName: "svg-figure", hProperties: { svg, alt: img.alt ?? "", caption: img.title ?? img.alt ?? "" }, hChildren: [] };
        }
      }
    });
    visit(tree, (n) => {
      const node = n as unknown as AnyNode;
      if (node.type === "code") {
        const c = node as unknown as Code;
        const lang = (c.lang ?? "").toLowerCase();
        const meta = c.meta ?? "";
        if (lang === "quiz") {
          const quizId = `${opts.lessonId ?? "q"}-quiz${++quizIndex}`;
          const questions = quizToView(normalizeQuizYaml(c.value, quizId));
          node.data = {
            hName: "lesson-quiz",
            hProperties: { json: JSON.stringify(questions), quizid: quizId, lessonid: opts.lessonId ?? "" },
            hChildren: [],
          };
        } else if (lang === "competition" && opts.runnable) {
          // решение соревнования: в блоке — базовое решение (заготовка), в meta — id соревнования
          node.data = {
            hName: "competition-submit",
            hProperties: { competition: meta.trim(), code: c.value, html: highlightPython(c.value) },
            hChildren: [],
          };
        } else if ((lang === "python" || lang === "py") && opts.runnable && !/\bnorun\b/.test(meta)) {
          node.data = {
            hName: "runnable-code",
            hProperties: { code: c.value, index: String(runIndex++), html: highlightPython(c.value) },
            hChildren: [],
          };
        } else {
          const html = lang === "python" || lang === "py" ? highlightPython(c.value) : escapeHtml(c.value);
          node.data = { hName: "static-code", hProperties: { html, lang: lang || "text" }, hChildren: [] };
        }
      } else if (node.type === "containerDirective") {
        const name = String(node.name);
        if (CALLOUTS.includes(name)) {
          let title = "";
          const first = node.children?.[0];
          if (first && (first.data as Record<string, unknown> | undefined)?.directiveLabel) {
            title = mdToString(first as never);
            node.children = node.children!.slice(1);
          }
          node.data = { hName: "callout", hProperties: { kind: name, title } };
        }
      } else if (node.type === "textDirective" || node.type === "leafDirective") {
        // ":слово" в обычном тексте не должно превращаться в директиву — возвращаем текст
        const txt = (node.type === "leafDirective" ? "::" : ":") + String(node.name) + (node.children?.length ? mdToString(node as never) : "");
        node.type = "text";
        (node as AnyNode).value = txt;
        delete node.children;
      }
    });
  };
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
}

/** Заголовки второго уровня урока (для оглавления), без строк внутри блоков кода. */
export function extractHeadings(markdown: string): { id: string; text: string }[] {
  const res: { id: string; text: string }[] = [];
  let inCode = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line)) inCode = !inCode;
    if (inCode) continue;
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      const text = m[1].replace(/[`*_]/g, "");
      res.push({ id: slugify(text), text });
    }
  }
  return res;
}

function rehypeHeadingIds() {
  return (tree: HastRoot) => {
    visit(tree, "element", (node: { tagName: string; properties?: Record<string, unknown>; children?: unknown[] }) => {
      if (node.tagName === "h2" || node.tagName === "h3") {
        const text = hastText(node);
        node.properties = { ...(node.properties ?? {}), id: slugify(text) };
      }
    });
  };
}

// Блок кода в Markdown всегда становится <pre><code>…</code></pre>; для особых блоков мы заменяем <code>
// своим элементом, но обёртка <pre> остаётся — и квиз или форма наследуют моноширинный шрифт и white-space: pre.
// Снимаем эту обёртку, если внутри только особый блок.
const CUSTOM_BLOCKS = new Set(["lesson-quiz", "runnable-code", "competition-submit", "static-code"]);

function rehypeUnwrapCustomBlocks() {
  return (tree: HastRoot) => {
    const walk = (parent: { children: ElementContent[] | HastRoot["children"] }) => {
      const kids = parent.children as ElementContent[];
      for (let i = 0; i < kids.length; i++) {
        const node = kids[i];
        if (node.type !== "element") continue;
        if (node.tagName === "pre") {
          const inner = node.children.filter((c) => !(c.type === "text" && !c.value.trim()));
          if (inner.length === 1 && inner[0].type === "element" && CUSTOM_BLOCKS.has((inner[0] as HastElement).tagName)) {
            kids[i] = inner[0];
            continue;
          }
        }
        walk(node);
      }
    };
    walk(tree);
  };
}

function hastText(node: unknown): string {
  const n = node as { type?: string; value?: string; children?: unknown[] };
  if (n.type === "text") return n.value ?? "";
  return (n.children ?? []).map(hastText).join("");
}

export interface LessonSection {
  title: string; // заголовок раздела (## …) или пусто для вступления
  markdown: string; // текст раздела вместе с заголовком
  isQuiz: boolean; // раздел «Мини-квиз»
  runnableCount: number; // сколько запускаемых примеров внутри
  quizCount: number; // сколько блоков ```quiz внутри
}

/** Разбить урок на разделы по заголовкам второго уровня (строки внутри блоков кода не учитываются). */
export function splitSections(markdown: string): LessonSection[] {
  const lines = markdown.split("\n");
  const chunks: { title: string; lines: string[] }[] = [{ title: "", lines: [] }];
  let inCode = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) inCode = !inCode;
    const m = !inCode ? /^##\s+(.+?)\s*$/.exec(line) : null;
    if (m) chunks.push({ title: m[1].replace(/[`*_]/g, ""), lines: [line] });
    else chunks[chunks.length - 1].lines.push(line);
  }
  return chunks
    .filter((c) => c.title || c.lines.join("").trim())
    .map((c) => {
      const md = c.lines.join("\n");
      const runnable = (md.match(/```(python|py)(?![^\n]*\bnorun\b)[^\n]*\n/g) ?? []).length;
      const quizzes = (md.match(/```quiz\n/g) ?? []).length;
      return { title: c.title, markdown: md, isQuiz: c.title === "Мини-квиз", runnableCount: runnable, quizCount: quizzes };
    });
}

/** «:::tip Заголовок» → «:::tip[Заголовок]» (удобная запись выносок), кроме строк внутри блоков кода. */
export function preprocessDirectives(markdown: string): string {
  let inCode = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) inCode = !inCode;
      if (inCode) return line;
      const m = /^(\s*):::(\w+)[ \t]+([^[\]{}].*?)\s*$/.exec(line);
      return m ? `${m[1]}:::${m[2]}[${m[3]}]` : line;
    })
    .join("\n");
}

function toHast(markdown: string, opts: MdOptions): HastRoot {
  markdown = preprocessDirectives(markdown);
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkDirective)
    .use(remarkCourse, opts)
    .use(remarkRehype)
    .use(rehypeUnwrapCustomBlocks)
    .use(rehypeHeadingIds)
    .use(rehypeKatex, { strict: false, throwOnError: false });
  const mdast = processor.parse(markdown);
  return processor.runSync(mdast) as HastRoot;
}

/** Markdown → HTML-строка (для справочника и коротких текстов на клиенте). */
export function mdToHtml(markdown: string, opts: MdOptions = {}): string {
  return toHtml(toHast(markdown, opts));
}

/** Markdown → React-узлы с компонентами курса. */
export function renderMarkdown(markdown: string, components: Partial<Components>, opts: MdOptions = {}): ReactNode {
  const hast = toHast(markdown, opts);
  return toJsxRuntime(hast, {
    Fragment,
    jsx: jsx as never,
    jsxs: jsxs as never,
    components: components as Components,
    elementAttributeNameCase: "react",
    stylePropertyNameCase: "dom",
  });
}

/** Простой инлайн-Markdown (без абзаца-обёртки) — для вариантов ответа и заголовков. */
export function mdInlineToHtml(markdown: string): string {
  const html = mdToHtml(markdown);
  return html.replace(/^<p>([\s\S]*)<\/p>\s*$/, "$1");
}
