// Проверка присланных прогнозов и подсчёт метрик. Чистые функции без доступа к ответам:
// ответы передаёт вызывающая серверная функция, поэтому модуль можно тестировать отдельно.

export type ValidationResult = { ok: true; predictions: number[] } | { ok: false; error: string };

export interface Score {
  mae: number;
  medianAe: number;
  n: number;
}

const listPreview = (xs: number[], n = 5) => xs.slice(0, n).join(", ") + (xs.length > n ? ", …" : "");

/**
 * Проверяет тело запроса { ids, predictions } и возвращает прогнозы в порядке expectedIds.
 * Никаких предположений о порядке строк ученика: сопоставление — по ID.
 */
export function validateSubmission(body: unknown, expectedIds: readonly number[], range: readonly [number, number]): ValidationResult {
  if (!body || typeof body !== "object") return { ok: false, error: "Пустой запрос: нужны массивы ids и predictions." };
  const { ids, predictions } = body as { ids?: unknown; predictions?: unknown };
  if (!Array.isArray(ids) || !Array.isArray(predictions)) return { ok: false, error: "Нужны два массива: ids и predictions." };
  if (ids.length !== predictions.length) return { ok: false, error: `Длины не совпадают: ID — ${ids.length}, прогнозов — ${predictions.length}.` };

  const expected = new Set(expectedIds);
  const position = new Map<number, number>();
  const extra: number[] = [];
  const duplicates: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (typeof id !== "number" || !Number.isInteger(id)) return { ok: false, error: `ID должны быть целыми числами, а в строке ${i + 1} — ${JSON.stringify(id)}.` };
    if (!expected.has(id)) extra.push(id);
    else if (position.has(id)) duplicates.push(id);
    else position.set(id, i);
  }
  if (duplicates.length) return { ok: false, error: `Повторяются ID: ${listPreview(duplicates)}. У каждой машины должен быть ровно один прогноз.` };
  if (extra.length) return { ok: false, error: `Лишние ID, которых нет в проверочной части: ${listPreview(extra)}.` };
  const missing = expectedIds.filter((id) => !position.has(id));
  if (missing.length) return { ok: false, error: `Нет прогнозов для ${missing.length} машин (ID ${listPreview(missing)}). Нужен прогноз для каждой строки проверочной части.` };

  const [lo, hi] = range;
  const ordered: number[] = new Array(expectedIds.length);
  for (let k = 0; k < expectedIds.length; k++) {
    const i = position.get(expectedIds[k])!;
    const v = predictions[i];
    if (typeof v !== "number" || !Number.isFinite(v)) return { ok: false, error: `Прогноз для ID ${expectedIds[k]} — не число (${JSON.stringify(v)}). Пропуски и бесконечности не принимаются.` };
    if (v < lo || v > hi) return { ok: false, error: `Прогноз для ID ${expectedIds[k]} равен ${v} — вне допустимого диапазона от ${lo} до ${hi}.` };
    ordered[k] = v;
  }
  return { ok: true, predictions: ordered };
}

export type LabelValidationResult = { ok: true; labels: string[] } | { ok: false; error: string };

const strPreview = (xs: string[], n = 5) => xs.slice(0, n).join(", ") + (xs.length > n ? ", …" : "");

/**
 * Проверяет тело запроса { ids, predictions } для соревнования с классами: ID — строки проверочной части,
 * прогнозы — названия классов из списка `labels`. Возвращает прогнозы в порядке expectedIds.
 */
export function validateLabels(body: unknown, expectedIds: readonly string[], labels: readonly string[]): LabelValidationResult {
  if (!body || typeof body !== "object") return { ok: false, error: "Пустой запрос: нужны массивы ids и predictions." };
  const { ids, predictions } = body as { ids?: unknown; predictions?: unknown };
  if (!Array.isArray(ids) || !Array.isArray(predictions)) return { ok: false, error: "Нужны два массива: ids и predictions." };
  if (ids.length !== predictions.length) return { ok: false, error: `Длины не совпадают: ID — ${ids.length}, ответов — ${predictions.length}.` };

  const expected = new Set(expectedIds);
  const position = new Map<string, number>();
  const extra: string[] = [];
  const duplicates: string[] = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (typeof id !== "string") return { ok: false, error: `ID должны быть строками из колонки ID, а в строке ${i + 1} — ${JSON.stringify(id)}.` };
    if (!expected.has(id)) extra.push(id);
    else if (position.has(id)) duplicates.push(id);
    else position.set(id, i);
  }
  if (duplicates.length) return { ok: false, error: `Повторяются ID: ${strPreview(duplicates)}. У каждой картинки должен быть ровно один ответ.` };
  if (extra.length) return { ok: false, error: `Лишние ID, которых нет в проверочной части: ${strPreview(extra)}.` };
  const missing = expectedIds.filter((id) => !position.has(id));
  if (missing.length) return { ok: false, error: `Нет ответов для ${missing.length} картинок (ID ${strPreview(missing)}). Нужен ответ для каждой строки проверочной части.` };

  const known = new Set(labels);
  const ordered: string[] = new Array(expectedIds.length);
  const unknown: string[] = [];
  for (let k = 0; k < expectedIds.length; k++) {
    const v = predictions[position.get(expectedIds[k])!];
    if (typeof v !== "string") return { ok: false, error: `Ответ для ID ${expectedIds[k]} — не строка (${JSON.stringify(v)}). Нужно название класса.` };
    if (!known.has(v)) unknown.push(v);
    ordered[k] = v;
  }
  if (unknown.length) {
    const sample = [...new Set(unknown)];
    return { ok: false, error: `Неизвестные классы у ${unknown.length} картинок: ${strPreview(sample, 3)}. Ответ — название класса точно как в колонке class, например «phoenicopterus-ruber», а не перевод.` };
  }
  return { ok: true, labels: ordered };
}

export type ChoiceValidationResult = { ok: true; predictions: number[] } | { ok: false; error: string };

/**
 * Проверяет тело запроса { ids, predictions } для теста с вариантами ответа: ID — целые числа проверочной части,
 * ответы — номера вариантов (целые). Недопустимый номер не ошибка формата — он просто будет неверным.
 * Возвращает ответы в порядке expectedIds.
 */
export function validateChoices(body: unknown, expectedIds: readonly number[]): ChoiceValidationResult {
  if (!body || typeof body !== "object") return { ok: false, error: "Пустой запрос: нужны массивы ids и predictions." };
  const { ids, predictions } = body as { ids?: unknown; predictions?: unknown };
  if (!Array.isArray(ids) || !Array.isArray(predictions)) return { ok: false, error: "Нужны два массива: ids и predictions." };
  if (ids.length !== predictions.length) return { ok: false, error: `Длины не совпадают: ID — ${ids.length}, ответов — ${predictions.length}.` };

  const expected = new Set(expectedIds);
  const position = new Map<number, number>();
  const extra: number[] = [];
  const duplicates: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (typeof id !== "number" || !Number.isInteger(id)) return { ok: false, error: `ID должны быть целыми числами, а в строке ${i + 1} — ${JSON.stringify(id)}.` };
    if (!expected.has(id)) extra.push(id);
    else if (position.has(id)) duplicates.push(id);
    else position.set(id, i);
  }
  if (duplicates.length) return { ok: false, error: `Повторяются ID: ${listPreview(duplicates)}. У каждого вопроса должен быть ровно один ответ.` };
  if (extra.length) return { ok: false, error: `Лишние ID, которых нет в проверочной части: ${listPreview(extra)}.` };
  const missing = expectedIds.filter((id) => !position.has(id));
  if (missing.length) return { ok: false, error: `Нет ответов для ${missing.length} вопросов (ID ${listPreview(missing)}). Нужен ответ на каждый вопрос теста.` };

  const ordered: number[] = new Array(expectedIds.length);
  for (let k = 0; k < expectedIds.length; k++) {
    const v = predictions[position.get(expectedIds[k])!];
    if (typeof v !== "number" || !Number.isFinite(v)) return { ok: false, error: `Ответ на вопрос ${expectedIds[k]} — не число (${JSON.stringify(v)}). Нужен номер варианта.` };
    if (!Number.isInteger(v)) return { ok: false, error: `Ответ на вопрос ${expectedIds[k]} равен ${v}, а номер варианта — целое число.` };
    if (Math.abs(v) > 1_000_000) return { ok: false, error: `Ответ на вопрос ${expectedIds[k]} равен ${v} — это не номер варианта.` };
    ordered[k] = v;
  }
  return { ok: true, predictions: ordered };
}

/**
 * Доля верных номеров на оцениваемых вопросах. predictions идут в порядке expectedIds; scoredIds и truth —
 * оцениваемые вопросы и их правильные номера (вопросы вне scoredIds не влияют на результат).
 */
export function scoreChoices(
  expectedIds: readonly number[],
  predictions: readonly number[],
  scoredIds: readonly number[],
  truth: readonly number[]
): { accuracy: number; correct: number; n: number } {
  if (expectedIds.length !== predictions.length || scoredIds.length !== truth.length || !scoredIds.length) {
    throw new Error("scoreChoices: разная длина или пустые массивы");
  }
  const byId = new Map<number, number>();
  expectedIds.forEach((id, k) => byId.set(id, predictions[k]));
  const correct = scoredIds.reduce((s, id, k) => s + (byId.get(id) === truth[k] ? 1 : 0), 0);
  return { accuracy: correct / scoredIds.length, correct, n: scoredIds.length };
}

/** Доля верных ответов; truth и predictions — в одном порядке. */
export function scoreAccuracy(truth: readonly string[], predictions: readonly string[]): { accuracy: number; correct: number; n: number } {
  if (truth.length !== predictions.length || !truth.length) throw new Error("scoreAccuracy: разная длина или пустые массивы");
  const correct = truth.reduce((s, y, i) => s + (y === predictions[i] ? 1 : 0), 0);
  return { accuracy: correct / truth.length, correct, n: truth.length };
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (!n) return NaN;
  const mid = Math.floor(n / 2);
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** MAE и медиана модуля ошибки; truth и predictions — в одном порядке. */
export function scorePredictions(truth: readonly number[], predictions: readonly number[]): Score {
  if (truth.length !== predictions.length || !truth.length) throw new Error("scorePredictions: разная длина или пустые массивы");
  const errors = truth.map((y, i) => Math.abs(y - predictions[i]));
  const mae = errors.reduce((s, e) => s + e, 0) / errors.length;
  return { mae, medianAe: median([...errors].sort((a, b) => a - b)), n: errors.length };
}

/** На сколько процентов результат лучше baseline (положительное — лучше, отрицательное — хуже). */
export function improvementPercent(mae: number, baselineMae: number): number {
  return baselineMae > 0 ? (100 * (baselineMae - mae)) / baselineMae : 0;
}
