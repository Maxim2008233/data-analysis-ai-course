// Соревнования курса: открытые настройки (нужны и браузеру, и серверу). Ответы здесь НЕ хранятся —
// они лежат в private/competitions/<id>/answers.json и читаются только серверной функцией.
import zeroShotClasses from "./zero-shot-classes.json";

/** Как оцениваются ответы: MAE по числам (меньше — лучше) или доля верных классов (больше — лучше). */
export type MetricKind = "mae" | "accuracy";

export interface CompetitionConfig {
  id: string;
  title: string;
  /** Датасеты, которые получает код ученика в Pyodide (из public/data). */
  files: string[];
  /** Файл с объектами проверочной части: по нему сверяется полнота прогнозов ещё в браузере. */
  testFile: string;
  idColumn: string;
  /** ID в проверочной части — целые числа или строки. */
  idType: "int" | "string";
  predictionColumn: string;
  /** Что прогнозируют: число (цену), класс из списка `labels` или номер варианта ответа (целое число). */
  predictionType: "number" | "label" | "choice";
  /** Допустимые классы (для predictionType: "label"): сервер и браузер проверяют по ним формат ответа. */
  labels?: readonly string[];
  /** Допустимый диапазон одного числового прогноза: защищает от случайных NaN/inf и мусорных значений. */
  predictionRange: [number, number];
  metric: MetricKind;
  metricLabel: string;
  /** Название метрики в винительном падеже: «сервер считает MAE», «сервер считает долю верных». */
  metricLabelAcc: string;
  /** Чем меньше метрика, тем лучше (MAE); для доли верных — наоборот. */
  lowerIsBetter: boolean;
  /** Что лежит в скрытых ответах — для подписей: «по скрытым ценам», «по скрытым классам». */
  hiddenWhat: string;
  /** Формы слова для объектов проверочной части: «1 машина», «2 машины», «5 машин». */
  objectForms: [string, string, string];
  /** Винительный падеж: «по строке на каждую машину». */
  objectAcc: string;
  /**
   * Результат базового решения (заготовки) на скрытой части; валидатор контента сверяет его с расчётом.
   * score — значение метрики, second — дополнительное число (медиана ошибки для MAE, число верных для доли верных).
   */
  baseline: { score: number; second: number };
  /** Сколько отправок засчитывается за 24 часа на одного ученика (гостя — по IP). */
  dailyLimit: number;
  /** Сколько секунд даётся коду ученика в браузере. */
  timeout: number;
  /** Можно загрузить готовый файл ответов CSV (например, сделанный в Colab с настоящей моделью). */
  upload?: boolean;
}

export const COMPETITIONS: Record<string, CompetitionConfig> = {
  "cars-price": {
    id: "cars-price",
    title: "Оценка цены автомобиля",
    files: ["competition_cars_train.csv", "competition_cars_test.csv"],
    testFile: "competition_cars_test.csv",
    idColumn: "ID",
    idType: "int",
    predictionColumn: "Predict",
    predictionType: "number",
    predictionRange: [0, 10_000_000],
    metric: "mae",
    metricLabel: "MAE",
    metricLabelAcc: "MAE",
    lowerIsBetter: true,
    hiddenWhat: "ценам",
    objectForms: ["машина", "машины", "машин"],
    objectAcc: "машину",
    baseline: { score: 11792, second: 4822 },
    dailyLimit: 10,
    timeout: 120,
  },
  "zero-shot": {
    id: "zero-shot",
    title: "Zero-shot классификация картинок",
    files: ["zs_public.csv", "zs_public.npy", "zs_prompts.npz", "competition_zs_test.csv", "competition_zs_test.npy"],
    testFile: "competition_zs_test.csv",
    idColumn: "ID",
    idType: "string",
    predictionColumn: "predicted_class",
    predictionType: "label",
    labels: zeroShotClasses as string[],
    predictionRange: [0, 0],
    metric: "accuracy",
    metricLabel: "доля верных",
    metricLabelAcc: "долю верных",
    lowerIsBetter: false,
    hiddenWhat: "классам",
    objectForms: ["картинка", "картинки", "картинок"],
    objectAcc: "картинку",
    baseline: { score: 0.6048, second: 427 },
    dailyLimit: 10,
    timeout: 120,
  },
  qa: {
    id: "qa",
    title: "Тест с вариантами ответа",
    files: ["qa_train.csv", "qa_test.csv", "qa_gigachat_baseline.csv"],
    testFile: "qa_test.csv",
    idColumn: "id",
    idType: "int",
    predictionColumn: "prediction",
    predictionType: "choice",
    // номер варианта — любое целое: недопустимый номер (4 при четырёх вариантах, год) просто считается неверным
    predictionRange: [-1_000_000, 1_000_000],
    metric: "accuracy",
    metricLabel: "доля верных",
    metricLabelAcc: "долю верных",
    lowerIsBetter: false,
    hiddenWhat: "ответам",
    objectForms: ["вопрос", "вопроса", "вопросов"],
    objectAcc: "вопрос",
    baseline: { score: 0.6844, second: 501 },
    dailyLimit: 10,
    timeout: 120,
    upload: true,
  },
};

export function getCompetition(id: string): CompetitionConfig | null {
  return Object.prototype.hasOwnProperty.call(COMPETITIONS, id) ? COMPETITIONS[id] : null;
}

/** Ключ записи прогресса соревнования (лучший результат, число отправок, код решения). */
export function competitionKey(id: string): string {
  return `comp:${id}`;
}

/** Число и слово в нужной форме: «1 машина», «3 картинки», «706 картинок». */
export function countObjects(comp: CompetitionConfig, n: number): string {
  const a = n % 100;
  const b = n % 10;
  const [one, few, many] = comp.objectForms;
  return `${n.toLocaleString("ru-RU")} ${a >= 11 && a <= 14 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many}`;
}

/** Значение метрики для показа: MAE — целым числом, доля верных — в процентах с одним знаком. */
export function formatScore(comp: CompetitionConfig, v: number): string {
  if (comp.metric === "accuracy") return `${(100 * v).toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
  return Math.round(v).toLocaleString("ru-RU");
}

/** a лучше b с учётом направления метрики. */
export function isBetter(comp: CompetitionConfig, a: number, b: number): boolean {
  return comp.lowerIsBetter ? a < b : a > b;
}

/** Насколько результат лучше baseline: для MAE — в процентах, для доли верных — в процентных пунктах. */
export function improvementOver(comp: CompetitionConfig, score: number): number {
  const base = comp.baseline.score;
  if (comp.metric === "accuracy") return 100 * (score - base);
  return base > 0 ? (100 * (base - score)) / base : 0;
}

/** Подпись к улучшению: «на 12,5 %» или «на 27,1 п. п.». */
export function formatImprovement(comp: CompetitionConfig, imp: number): string {
  const v = Math.abs(imp).toLocaleString("ru-RU", { maximumFractionDigits: 1 });
  return comp.metric === "accuracy" ? `${v} п. п.` : `${v} %`;
}

/**
 * В базе для любой метрики хранится величина «меньше — лучше» (колонки best_mae / mae): сама MAE или доля ошибок
 * 1 − accuracy. Так таблица лидеров сортируется одинаково для всех соревнований.
 */
export function toStoredLoss(comp: CompetitionConfig, score: number): number {
  return comp.metric === "accuracy" ? Math.round((1 - score) * 1e6) / 1e6 : score;
}

export function fromStoredLoss(comp: CompetitionConfig, loss: number): number {
  return comp.metric === "accuracy" ? Math.round((1 - loss) * 1e6) / 1e6 : loss;
}
