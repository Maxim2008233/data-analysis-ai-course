// Строка «Столбцы» под условием задания: какие столбцы данных берёт эталонное решение и что в них лежит.
// Ученику не нужно помнить, что цена — это `Price(euro)` (или `Price` после обработки), а год — столбец 0
// матрицы X: всё это написано прямо под условием. Описания столбцов — в content/columns.yaml.
//
// Как находятся столбцы (по эталонному решению задания):
//   NumPy  — номера столбцов матрицы X: X[:, 3], X[10:15, [0, 3]], X[mask, 1:3]… Названия по номерам — из
//            load_numeric() или из np.genfromtxt('cars.csv', usecols=[...]) в подготовке урока или задания;
//   Pandas — строки в решении, совпадающие с названиями столбцов датасетов задания (поле files задания
//            или урока), по порядку появления в решении.
// В задании можно задать список вручную (columns: [Year, Price]) или убрать строку (columns: false).
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { LessonSource, TaskSource } from "./types";

export interface ColumnItem {
  /** Название столбца в данных. */
  name: string;
  /** Описание из content/columns.yaml; null — описания нет (это ошибка валидатора). */
  label: string | null;
  /** Номер столбца матрицы X (только для NumPy). */
  index?: number;
  /** Датасет, из которого столбец. */
  dataset: string;
}

export interface TaskColumns {
  /** Матрица NumPy, если столбцы — её номера (X). */
  matrix?: string;
  items: ColumnItem[];
}

export interface ColumnDictionary {
  numeric: string[];
  datasets: Record<string, Record<string, string>>;
  /** Заголовки CSV из public/data: название файла → столбцы по порядку. */
  headers: Record<string, string[]>;
}

let cached: ColumnDictionary | null = null;

/** Словарь описаний и заголовки датасетов (читается один раз за сборку). */
export function loadColumnDictionary(root = process.cwd()): ColumnDictionary {
  if (cached && root === process.cwd()) return cached;
  const raw = YAML.parse(fs.readFileSync(path.join(root, "content", "columns.yaml"), "utf8")) as {
    load_numeric?: string[];
    datasets?: Record<string, Record<string, unknown>>;
  };
  const datasets: Record<string, Record<string, string>> = {};
  for (const [file, cols] of Object.entries(raw.datasets ?? {})) {
    datasets[file] = Object.fromEntries(Object.entries(cols ?? {}).map(([k, v]) => [String(k), String(v)]));
  }
  const headers: Record<string, string[]> = {};
  const dataDir = path.join(root, "public", "data");
  for (const f of fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : []) {
    if (!f.endsWith(".csv")) continue;
    const fd = fs.openSync(path.join(dataDir, f), "r");
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const first = buf.toString("utf8", 0, n).replace(/^﻿/, "").split(/\r?\n/)[0];
    headers[f] = first.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  }
  const dict: ColumnDictionary = { numeric: (raw.load_numeric ?? []).map(String), datasets, headers };
  if (root === process.cwd()) cached = dict;
  return dict;
}

/** Обращения NAME[ … ] с учётом вложенных скобок: [имя, содержимое скобок, позиция начала содержимого]. */
function subscripts(code: string): [string, string, number][] {
  const out: [string, string, number][] = [];
  const re = /([A-Za-z_][\w.]*)\[/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    let depth = 1;
    let i = re.lastIndex;
    for (; i < code.length && depth > 0; i++) {
      if (code[i] === "[") depth++;
      else if (code[i] === "]") depth--;
    }
    out.push([m[1], code.slice(re.lastIndex, i - 1), re.lastIndex]);
  }
  return out;
}

/** Часть индекса после последней запятой верхнего уровня — столбцы (X[строки, столбцы]) и её смещение. */
function columnPart(inner: string): { text: string; offset: number } | null {
  let depth = 0;
  let last = -1;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth--;
    else if (ch === "," && depth === 0) last = i;
  }
  if (last < 0) return null;
  const raw = inner.slice(last + 1);
  return { text: raw.trim(), offset: last + 1 + (raw.length - raw.trimStart().length) };
}

/** Номера столбцов матрицы X в коде, по порядку появления. width — число столбцов (для срезов вида 1:). */
export function matrixColumnIndices(code: string, width: number, matrix = "X"): number[] {
  const found: [number, number][] = []; // [позиция в коде, номер столбца]
  let pos = 0;
  const add = (k: number) => {
    const j = k < 0 ? width + k : k;
    if (j >= 0 && j < width) found.push([pos, j]);
  };
  for (const [name, inner, start] of subscripts(code)) {
    if (name !== matrix) continue;
    const part = columnPart(inner);
    if (part === null) continue;
    pos = start + part.offset;
    const col = part.text;
    let mm: RegExpExecArray | null;
    if ((mm = /^-?\d+$/.exec(col))) add(Number(mm[0]));
    else if ((mm = /^\[\s*(-?\d+(?:\s*,\s*-?\d+)*)\s*,?\s*\]$/.exec(col))) mm[1].split(",").forEach((x) => add(Number(x.trim())));
    else if ((mm = /^(-?\d+)?\s*:\s*(-?\d+)?$/.exec(col)) && (mm[1] !== undefined || mm[2] !== undefined)) {
      const a = mm[1] !== undefined ? Number(mm[1]) : 0;
      const b = mm[2] !== undefined ? Number(mm[2]) : width;
      const from = a < 0 ? width + a : a;
      const to = b < 0 ? width + b : b;
      for (let k = from; k < to; k++) add(k);
    }
  }
  // по порядку появления в коде, без повторов
  const out: number[] = [];
  for (const [, j] of found.sort((a, b) => a[0] - b[0])) if (!out.includes(j)) out.push(j);
  return out;
}

/**
 * Строковые литералы Python в коде, по порядку появления. Строка читается целиком от кавычки до кавычки
 * (префиксы r/b/u/f, тройные кавычки, экранирование), комментарии «#» пропускаются; f- и b-строки не берутся.
 */
export function stringLiterals(code: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < code.length) {
    const ch = code[i];
    if (ch === "#") {
      const nl = code.indexOf("\n", i);
      i = nl < 0 ? code.length : nl;
      continue;
    }
    if (ch !== "'" && ch !== '"') {
      i++;
      continue;
    }
    let p = i;
    while (p > 0 && /[A-Za-z]/.test(code[p - 1])) p--;
    const prefix = code.slice(p, i).toLowerCase();
    const quote = code.startsWith(ch.repeat(3), i) ? ch.repeat(3) : ch;
    let j = i + quote.length;
    let content = "";
    while (j < code.length && !code.startsWith(quote, j)) {
      if (quote.length === 1 && code[j] === "\n") break; // незакрытая строка
      if (code[j] === "\\") {
        content += code.slice(j, j + 2);
        j += 2;
        continue;
      }
      content += code[j];
      j++;
    }
    if (!prefix.includes("f") && !prefix.includes("b")) out.push(content);
    i = j + quote.length;
  }
  return out;
}

/** Названия столбцов матрицы X по коду подготовки: load_numeric() или np.genfromtxt('cars.csv', usecols=[…]). */
function matrixNames(context: string, dict: ColumnDictionary): string[] | null {
  if (/\bload_numeric\(/.test(context)) return dict.numeric;
  const g = /genfromtxt\(\s*['"]([\w.]+\.csv)['"][^)]*?usecols\s*=\s*\[([\d,\s]+)\]/.exec(context);
  if (g && dict.headers[g[1]]) {
    const header = dict.headers[g[1]];
    const names = g[2].split(",").map((x) => header[Number(x.trim())]);
    if (names.every(Boolean)) return names;
  }
  return null;
}

/** В каком датасете искать описание столбца матрицы (load_numeric — это cars.csv). */
function matrixDataset(context: string): string {
  const g = /genfromtxt\(\s*['"]([\w.]+\.csv)['"]/.exec(context);
  return g ? g[1] : "cars.csv";
}

/** Столбцы, которые берёт эталонное решение задания; null — строку «Столбцы» не показывать. */
export function taskColumns(task: TaskSource, lesson: Pick<LessonSource, "setup" | "files">, dict: ColumnDictionary): TaskColumns | null {
  if (task.columns === false || !task.solution) return null;
  const solution = task.solution;
  const files = (task.files?.length ? task.files : lesson.files ?? []).filter((f) => dict.headers[f]);
  const describe = (name: string, dataset: string): ColumnItem => ({ name, dataset, label: dict.datasets[dataset]?.[name] ?? null });

  // ручной список в задании
  if (Array.isArray(task.columns)) {
    const items = task.columns.map((name) => {
      const ds = files.find((f) => dict.headers[f].includes(name)) ?? files[0] ?? "";
      return describe(name, ds);
    });
    return items.length ? { items } : null;
  }

  // NumPy: номера столбцов матрицы X
  const context = [lesson.setup ?? "", task.prelude ?? "", solution].join("\n");
  const names = matrixNames(context, dict);
  if (names) {
    const idx = matrixColumnIndices(solution, names.length);
    if (idx.length) {
      const ds = matrixDataset(context);
      return { matrix: "X", items: idx.map((k) => ({ ...describe(names[k], ds), index: k })) };
    }
  }

  // Pandas: названия столбцов датасетов задания
  const items: ColumnItem[] = [];
  for (const lit of stringLiterals(solution)) {
    if (!lit.trim() || items.some((it) => it.name === lit)) continue;
    const ds = files.find((f) => dict.headers[f].includes(lit));
    if (ds) items.push(describe(lit, ds));
  }
  return items.length ? { items } : null;
}
