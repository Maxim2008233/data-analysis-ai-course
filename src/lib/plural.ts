/** Форма слова после числа по правилам русского языка: pluralWord(61, ["задание", "задания", "заданий"]) → «задание». */
export function pluralWord(n: number, forms: readonly [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a >= 11 && a <= 14) return forms[2];
  if (b === 1) return forms[0];
  if (b >= 2 && b <= 4) return forms[1];
  return forms[2];
}

/** Число вместе со словом: plural(1, LESSON) → «1 урок», plural(61, TASK) → «61 задание». */
export function plural(n: number, forms: readonly [string, string, string]): string {
  return `${n} ${pluralWord(n, forms)}`;
}

export const LESSON = ["урок", "урока", "уроков"] as const;
export const TASK = ["задание", "задания", "заданий"] as const;
export const PART = ["часть", "части", "частей"] as const;
export const EXAMPLE = ["пример", "примера", "примеров"] as const;
export const PROBLEM = ["задача", "задачи", "задач"] as const;
export const TEST = ["тест", "теста", "тестов"] as const;
