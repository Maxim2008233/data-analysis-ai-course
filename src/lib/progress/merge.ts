// Правила слияния прогресса. Те же правила реализованы в SQL-функции public.merge_progress
// (supabase/migrations), поэтому браузер и база сливают данные одинаково и ничего не теряется:
//   status       — «сильнейший» (не начато < в процессе < решено);
//   attempts, fails, hints, submissions, maxStep — максимум;
//   solutionShown, theoryRead — «или»;
//   solvedAt, theoryReadAt — самая ранняя дата;
//   code + codeAt — более свежая версия кода;
//   quiz         — по каждому вопросу более свежий ответ;
//   best         — лучший результат (min, если lowerIsBetter);
//   at           — максимум; прочие поля — из более свежей записи.

export type TaskStatus = "not_started" | "in_progress" | "solved";

export interface QuizAnswer {
  answer: number[];
  correct: boolean;
  at: number;
}

export interface ProgressItem {
  status?: TaskStatus;
  code?: string;
  codeAt?: number;
  attempts?: number;
  fails?: number;
  hints?: number;
  maxStep?: number; // самый дальний открытый шаг урока
  solutionShown?: boolean;
  solvedAt?: number;
  theoryRead?: boolean;
  theoryReadAt?: number;
  quiz?: Record<string, QuizAnswer>;
  best?: number;
  lowerIsBetter?: boolean;
  lastScore?: number;
  submissions?: number;
  at?: number;
  [key: string]: unknown;
}

export type ItemsMap = Record<string, ProgressItem>;

const STATUS_RANK: Record<string, number> = { not_started: 0, in_progress: 1, solved: 2 };
const MAX_FIELDS = ["attempts", "fails", "hints", "submissions", "maxStep"];
const OR_FIELDS = ["solutionShown", "theoryRead"];
const MIN_DATE_FIELDS = ["solvedAt", "theoryReadAt"];
const HANDLED = new Set([
  "status",
  "code",
  "codeAt",
  "quiz",
  "best",
  "lowerIsBetter",
  "at",
  ...MAX_FIELDS,
  ...OR_FIELDS,
  ...MIN_DATE_FIELDS,
]);

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function mergeItem(a?: ProgressItem | null, b?: ProgressItem | null): ProgressItem {
  if (!a) return { ...(b ?? {}) };
  if (!b) return { ...a };
  const res: ProgressItem = {};
  const aAt = num(a.at) ?? 0;
  const bAt = num(b.at) ?? 0;
  const newer = bAt > aAt ? b : a;
  const older = newer === a ? b : a;

  // прочие поля — из более свежей записи
  for (const k of Object.keys(older)) if (!HANDLED.has(k)) res[k] = older[k];
  for (const k of Object.keys(newer)) if (!HANDLED.has(k)) res[k] = newer[k];

  // статус
  if (a.status || b.status) {
    const ra = STATUS_RANK[a.status ?? "not_started"] ?? 0;
    const rb = STATUS_RANK[b.status ?? "not_started"] ?? 0;
    res.status = (ra >= rb ? a.status : b.status) ?? "not_started";
  }
  for (const f of MAX_FIELDS) {
    const va = num(a[f]);
    const vb = num(b[f]);
    if (va !== undefined || vb !== undefined) res[f] = Math.max(va ?? 0, vb ?? 0);
  }
  for (const f of OR_FIELDS) {
    if (a[f] !== undefined || b[f] !== undefined) res[f] = Boolean(a[f]) || Boolean(b[f]);
  }
  for (const f of MIN_DATE_FIELDS) {
    const va = num(a[f]);
    const vb = num(b[f]);
    if (va !== undefined && vb !== undefined) res[f] = Math.min(va, vb);
    else if (va !== undefined || vb !== undefined) res[f] = (va ?? vb) as number;
  }
  // код: более свежая версия
  const aCodeAt = num(a.codeAt);
  const bCodeAt = num(b.codeAt);
  if (a.code !== undefined || b.code !== undefined) {
    const takeB = a.code === undefined || (b.code !== undefined && (bCodeAt ?? 0) > (aCodeAt ?? 0));
    res.code = takeB ? b.code : a.code;
    const at = takeB ? bCodeAt : aCodeAt;
    if (at !== undefined) res.codeAt = at;
  }
  // квизы
  if (a.quiz || b.quiz) {
    const q: Record<string, QuizAnswer> = { ...(a.quiz ?? {}) };
    for (const [k, v] of Object.entries(b.quiz ?? {})) {
      const prev = q[k];
      if (!prev || (num(v?.at) ?? 0) > (num(prev.at) ?? 0)) q[k] = v;
    }
    res.quiz = q;
  }
  // лучший результат соревнования
  const lower = Boolean(a.lowerIsBetter ?? b.lowerIsBetter);
  const ba = num(a.best);
  const bb = num(b.best);
  if (ba !== undefined || bb !== undefined) {
    if (ba === undefined) res.best = bb;
    else if (bb === undefined) res.best = ba;
    else res.best = lower ? Math.min(ba, bb) : Math.max(ba, bb);
  }
  if (a.lowerIsBetter !== undefined || b.lowerIsBetter !== undefined) res.lowerIsBetter = lower;
  if (aAt || bAt) res.at = Math.max(aAt, bAt);
  return res;
}

export function mergeMaps(a: ItemsMap, b: ItemsMap): ItemsMap {
  const res: ItemsMap = { ...a };
  for (const [k, v] of Object.entries(b)) res[k] = mergeItem(res[k], v);
  return res;
}

export function isSolved(item?: ProgressItem): boolean {
  return item?.status === "solved";
}

/** Сколько задач решено в `incoming`, но не решено в `base` (для уведомления о переносе). */
export function countNewlySolved(base: ItemsMap, incoming: ItemsMap): number {
  let n = 0;
  for (const [k, v] of Object.entries(incoming)) {
    if (k.startsWith("task:") && isSolved(v) && !isSolved(base[k])) n++;
  }
  return n;
}

export const EXPORT_FORMAT = "ds-course-progress";

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  version: 1;
  exportedAt: string;
  items: ItemsMap;
}

export function makeExport(items: ItemsMap): ExportFile {
  return { format: EXPORT_FORMAT, version: 1, exportedAt: new Date().toISOString(), items };
}

export function parseImport(text: string): ItemsMap {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Файл не похож на JSON. Выберите файл, сохранённый кнопкой «Экспорт прогресса».");
  }
  const d = data as Partial<ExportFile>;
  if (!d || d.format !== EXPORT_FORMAT || typeof d.items !== "object" || d.items === null) {
    throw new Error("Это не файл прогресса курса (нет поля format = ds-course-progress).");
  }
  const items: ItemsMap = {};
  for (const [k, v] of Object.entries(d.items)) {
    if (typeof k === "string" && /^(task|lesson|comp):/.test(k) && v && typeof v === "object") {
      items[k] = v as ProgressItem;
    }
  }
  return items;
}
