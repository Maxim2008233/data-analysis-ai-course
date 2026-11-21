import { describe, expect, it } from "vitest";
import { improvementPercent, scoreAccuracy, scoreChoices, scorePredictions, validateChoices, validateLabels, validateSubmission } from "../../src/lib/competitions/scoring";
import { parseSubmissionCsv } from "../../src/lib/competitions/csv";
import { formatWait, limitState, memoryLimiter, WINDOW_MS } from "../../src/lib/competitions/limits";
import {
  COMPETITIONS,
  countObjects,
  formatImprovement,
  formatScore,
  fromStoredLoss,
  getCompetition,
  improvementOver,
  isBetter,
  toStoredLoss,
} from "../../src/lib/competitions/registry";
import { normalizeNickname } from "../../src/lib/competitions/server";

const IDS = [1, 2, 3, 4];
const RANGE: [number, number] = [0, 1e7];

describe("validateSubmission — формат прогнозов", () => {
  it("принимает строки в любом порядке и возвращает прогнозы в порядке ID проверочной части", () => {
    const r = validateSubmission({ ids: [3, 1, 4, 2], predictions: [30, 10, 40, 20] }, IDS, RANGE);
    expect(r).toEqual({ ok: true, predictions: [10, 20, 30, 40] });
  });

  it("находит пропущенные, лишние и повторяющиеся ID", () => {
    const missing = validateSubmission({ ids: [1, 2, 3], predictions: [1, 2, 3] }, IDS, RANGE);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toContain("Нет прогнозов для 1");
    const extra = validateSubmission({ ids: [1, 2, 3, 99], predictions: [1, 2, 3, 4] }, IDS, RANGE);
    if (!extra.ok) expect(extra.error).toContain("Лишние ID");
    const dup = validateSubmission({ ids: [1, 2, 2, 4], predictions: [1, 2, 3, 4] }, IDS, RANGE);
    if (!dup.ok) expect(dup.error).toContain("Повторяются ID: 2");
    expect(extra.ok || dup.ok).toBe(false);
  });

  it("отклоняет не числа, бесконечности, значения вне диапазона и мусор вместо массивов", () => {
    const cases: unknown[] = [
      { ids: [1, 2, 3, 4], predictions: [1, null, 3, 4] },
      { ids: [1, 2, 3, 4], predictions: [1, 2, 3, "4"] },
      { ids: [1, 2, 3, 4], predictions: [1, 2, 3, -5] },
      { ids: [1, 2.5, 3, 4], predictions: [1, 2, 3, 4] },
      { ids: [1, 2, 3], predictions: [1, 2, 3, 4] },
      { ids: "1,2,3,4", predictions: [1, 2, 3, 4] },
      null,
    ];
    for (const c of cases) expect(validateSubmission(c, IDS, RANGE).ok).toBe(false);
  });
});

describe("метрики и лимиты", () => {
  it("MAE и медиана модуля ошибки", () => {
    const s = scorePredictions([100, 200, 300, 400], [110, 180, 300, 500]);
    expect(s.mae).toBeCloseTo((10 + 20 + 0 + 100) / 4);
    expect(s.medianAe).toBeCloseTo(15);
    expect(s.n).toBe(4);
    expect(improvementPercent(50, 100)).toBe(50);
    expect(improvementPercent(150, 100)).toBe(-50);
  });

  it("лимит за скользящие 24 часа", () => {
    const now = 10 * WINDOW_MS;
    const stamps = [now - WINDOW_MS - 1, now - 3_600_000, now - 60_000];
    expect(limitState(stamps, 3, now)).toEqual({ used: 2, remaining: 1, retryAfterMs: 0 });
    const full = limitState(stamps, 2, now);
    expect(full.remaining).toBe(0);
    expect(full.retryAfterMs).toBe(WINDOW_MS - 3_600_000);
    expect(formatWait(full.retryAfterMs)).toBe("23 ч 0 мин");
    memoryLimiter.clear();
    memoryLimiter.record("k", now - 1000);
    memoryLimiter.record("k", now - 500);
    expect(memoryLimiter.state("k", 2, now).remaining).toBe(0);
    expect(memoryLimiter.state("other", 2, now).remaining).toBe(2);
  });

  it("имя в таблице лидеров", () => {
    expect(normalizeNickname("  Маша   К. ")).toEqual({ ok: true, nickname: "Маша К." });
    expect(normalizeNickname("")).toEqual({ ok: true, nickname: null });
    expect(normalizeNickname("a").ok).toBe(false);
    expect(normalizeNickname("<script>").ok).toBe(false);
    expect(normalizeNickname("x".repeat(25)).ok).toBe(false);
  });

  it("реестр соревнований", () => {
    expect(getCompetition("cars-price")?.metric).toBe("mae");
    expect(getCompetition("zero-shot")?.metric).toBe("accuracy");
    expect(getCompetition("__proto__")).toBeNull();
    for (const c of Object.values(COMPETITIONS)) {
      expect(c.baseline.score).toBeGreaterThan(0);
      if (c.predictionType === "label") expect(c.labels?.length).toBeGreaterThan(0);
    }
  });
});

describe("соревнование с классами: формат ответов и доля верных", () => {
  const labels = ["cat", "dog", "panthera-leo"];
  const ids = ["t001", "t002", "t003"];

  it("принимает ответы в любом порядке и возвращает их в порядке ID проверочной части", () => {
    const r = validateLabels({ ids: ["t003", "t001", "t002"], predictions: ["panthera-leo", "cat", "dog"] }, ids, labels);
    expect(r).toEqual({ ok: true, labels: ["cat", "dog", "panthera-leo"] });
  });

  it("находит пропущенные, лишние, повторяющиеся ID, числа вместо строк и неизвестные классы", () => {
    const err = (body: unknown) => {
      const r = validateLabels(body, ids, labels);
      return r.ok ? "" : r.error;
    };
    expect(err({ ids: ["t001", "t002"], predictions: ["cat", "dog"] })).toContain("Нет ответов для 1 картинок");
    expect(err({ ids: ["t001", "t002", "t003", "t004"], predictions: ["cat", "dog", "cat", "cat"] })).toContain("Лишние ID");
    expect(err({ ids: ["t001", "t001", "t002"], predictions: ["cat", "dog", "cat"] })).toContain("Повторяются ID");
    expect(err({ ids: [1, 2, 3], predictions: ["cat", "dog", "cat"] })).toContain("строками");
    expect(err({ ids, predictions: ["cat", "lion", "lion"] })).toContain("Неизвестные классы у 2 картинок: lion");
    expect(err({ ids, predictions: ["cat", 7, "dog"] })).toContain("не строка");
    expect(err(null)).toContain("Пустой запрос");
  });

  it("доля верных и показ метрики", () => {
    expect(scoreAccuracy(["cat", "dog", "cat", "dog"], ["cat", "cat", "cat", "dog"])).toEqual({ accuracy: 0.75, correct: 3, n: 4 });
    const zs = getCompetition("zero-shot")!;
    const cars = getCompetition("cars-price")!;
    expect(formatScore(zs, 0.6048)).toBe("60,5 %");
    expect(formatScore(cars, 11792.4).replace(/\s/g, " ")).toBe("11 792"); // разделитель разрядов — узкий неразрывный пробел
    expect(isBetter(zs, 0.7, 0.6)).toBe(true);
    expect(isBetter(cars, 0.7, 0.6)).toBe(false);
    expect(improvementOver(zs, zs.baseline.score + 0.1)).toBeCloseTo(10, 6);
    expect(formatImprovement(zs, 27.1)).toBe("27,1 п. п.");
    expect(countObjects(zs, 706)).toBe("706 картинок");
    expect(countObjects(cars, 1)).toBe("1 машина");
    // в базе — величина «меньше — лучше»: доля ошибок для доли верных
    expect(toStoredLoss(zs, 0.8739)).toBeCloseTo(0.1261, 9);
    expect(fromStoredLoss(zs, toStoredLoss(zs, 0.8739))).toBeCloseTo(0.8739, 9);
    expect(toStoredLoss(cars, 5771)).toBe(5771);
  });
});

describe("соревнование 3: номера вариантов, оцениваемые вопросы и файл CSV", () => {
  const ids = [0, 1, 2, 3];

  it("принимает номера вариантов в любом порядке, недопустимый номер — не ошибка формата", () => {
    expect(validateChoices({ ids: [3, 0, 2, 1], predictions: [1, 2, 4, 0] }, ids)).toEqual({ ok: true, predictions: [2, 0, 4, 1] });
    expect(validateChoices({ ids, predictions: [0, 2025, -1, 3] }, ids)).toEqual({ ok: true, predictions: [0, 2025, -1, 3] });
  });

  it("находит пропуски, лишние и повторяющиеся ID, дробные номера и не числа", () => {
    const err = (body: unknown) => {
      const r = validateChoices(body, ids);
      return r.ok ? "" : r.error;
    };
    expect(err({ ids: [0, 1, 2], predictions: [0, 1, 2] })).toContain("Нет ответов для 1 вопросов");
    expect(err({ ids: [0, 1, 2, 3, 9], predictions: [0, 1, 2, 3, 1] })).toContain("Лишние ID");
    expect(err({ ids: [0, 0, 1, 2], predictions: [0, 1, 2, 3] })).toContain("Повторяются ID");
    expect(err({ ids, predictions: [0, 1.5, 2, 3] })).toContain("целое число");
    expect(err({ ids, predictions: [0, "2", 2, 3] })).toContain("не число");
    expect(err({ ids, predictions: [0, 1, 2, 5e9] })).toContain("не номер варианта");
  });

  it("доля верных считается только по оцениваемым вопросам", () => {
    // вопросы 0 и 2 оцениваются (ответы 1 и 3), 1 и 3 — нет
    expect(scoreChoices(ids, [1, 9, 0, 9], [0, 2], [1, 3])).toEqual({ accuracy: 0.5, correct: 1, n: 2 });
    expect(scoreChoices(ids, [1, 0, 3, 0], [0, 2], [1, 3])).toEqual({ accuracy: 1, correct: 2, n: 2 });
    const qa = getCompetition("qa")!;
    expect(qa.predictionType).toBe("choice");
    expect(qa.upload).toBe(true);
    expect(countObjects(qa, 730)).toBe("730 вопросов");
    expect(countObjects(qa, 1)).toBe("1 вопрос");
  });

  it("CSV из Colab: заголовок, разделители, ID вида 12.0, ошибки с номером строки", () => {
    const qa = getCompetition("qa")!;
    expect(parseSubmissionCsv("\uFEFFid,prediction\r\n0.0,2\n1.0,0\n", qa)).toEqual({ ok: true, submission: { ids: [0, 1], predictions: [2, 0] }, rows: 2 });
    expect(parseSubmissionCsv('"id";"prediction"\n5;3\n', qa)).toEqual({ ok: true, submission: { ids: [5], predictions: [3] }, rows: 1 });
    expect(parseSubmissionCsv(",id,prediction\n0,7,1\n", qa)).toEqual({ ok: true, submission: { ids: [7], predictions: [1] }, rows: 1 });
    const err = (text: string) => {
      const r = parseSubmissionCsv(text, qa);
      return r.ok ? "" : r.error;
    };
    expect(err("")).toContain("пустой");
    expect(err("ID,Predict\n1,2\n")).toContain("нужны колонки «id» и «prediction»");
    expect(err("id,prediction\n1,Ответ: 2\n")).toContain("Строка 2");
    expect(err("id,prediction\n1,2.5\n")).toContain("целым числом");
    expect(err("id,prediction\nx,2\n")).toContain("не целое число");
  });
});
