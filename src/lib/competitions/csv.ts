// Разбор загруженного файла ответов (CSV) в браузере: например, файла submission.csv, сделанного в Colab
// с настоящей моделью. Здесь только формат; полноту ID и метрику проверяет сервер, как для ответов из кода.
import type { CompetitionConfig } from "./registry";
import type { SubmissionData } from "./client";

export type CsvParseResult = { ok: true; submission: SubmissionData; rows: number } | { ok: false; error: string };

/** Больше строк в файле ответов не бывает: в проверочных частях курса — сотни и тысячи объектов. */
const MAX_ROWS = 20_000;

const unquote = (v: string) => v.trim().replace(/^"([\s\S]*)"$/, "$1").trim();

/**
 * Файл: первая строка — заголовок с колонками comp.idColumn и comp.predictionColumn (регистр не важен),
 * разделитель — запятая, точка с запятой или табуляция. ID — целые числа («12» или «12.0», как пишет pandas);
 * ответ — число, для теста с вариантами — целое.
 */
export function parseSubmissionCsv(text: string, comp: CompetitionConfig): CsvParseResult {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim() !== "");
  if (!lines.length) return { ok: false, error: "Файл пустой." };
  const head = lines[0];
  const delimiter = [";", ",", "\t"].reduce((best, d) => (head.split(d).length > head.split(best).length ? d : best), ",");
  const cols = head.split(delimiter).map((c) => unquote(c).toLowerCase());
  const idIdx = cols.indexOf(comp.idColumn.toLowerCase());
  const predIdx = cols.indexOf(comp.predictionColumn.toLowerCase());
  if (idIdx < 0 || predIdx < 0) {
    return {
      ok: false,
      error: `В первой строке файла нужны колонки «${comp.idColumn}» и «${comp.predictionColumn}», а сейчас: ${cols.join(", ") || "пусто"}. Сохраните ответы так: submission.to_csv('submission.csv', index=False).`,
    };
  }
  if (lines.length - 1 > MAX_ROWS) return { ok: false, error: `В файле ${lines.length - 1} строк — это не файл ответов.` };

  const ids: number[] = [];
  const predictions: number[] = [];
  for (let r = 1; r < lines.length; r++) {
    const cells = lines[r].split(delimiter).map(unquote);
    const idRaw = cells[idIdx] ?? "";
    const predRaw = cells[predIdx] ?? "";
    const id = Number(idRaw);
    if (idRaw === "" || !Number.isFinite(id) || !Number.isInteger(id)) {
      return { ok: false, error: `Строка ${r + 1}: ID «${idRaw}» — не целое число. ID берите из колонки «${comp.idColumn}» теста.` };
    }
    const value = Number(predRaw.replace(",", "."));
    if (predRaw === "" || !Number.isFinite(value)) {
      return { ok: false, error: `Строка ${r + 1} (ID ${id}): ответ «${predRaw}» — не число. Если модель не ответила, поставьте запасной номер.` };
    }
    if (comp.predictionType === "choice" && !Number.isInteger(value)) {
      return { ok: false, error: `Строка ${r + 1} (ID ${id}): ответ ${value} — номер варианта должен быть целым числом.` };
    }
    ids.push(id);
    predictions.push(value);
  }
  return { ok: true, submission: { ids, predictions }, rows: ids.length };
}
