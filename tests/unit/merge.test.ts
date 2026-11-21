import { describe, expect, it } from "vitest";
import { countNewlySolved, makeExport, mergeItem, mergeMaps, parseImport, type ProgressItem } from "../../src/lib/progress/merge";

describe("mergeItem — правила слияния прогресса", () => {
  it("решённое задание остаётся решённым (статус «сильнейший»)", () => {
    const a: ProgressItem = { status: "solved", at: 100 };
    const b: ProgressItem = { status: "in_progress", at: 200 };
    expect(mergeItem(a, b).status).toBe("solved");
    expect(mergeItem(b, a).status).toBe("solved");
  });

  it("код берётся из более свежей версии по codeAt", () => {
    const a: ProgressItem = { code: "old", codeAt: 10, at: 10 };
    const b: ProgressItem = { code: "new", codeAt: 20, at: 5 };
    expect(mergeItem(a, b).code).toBe("new");
    expect(mergeItem(b, a).code).toBe("new");
    expect(mergeItem(a, b).codeAt).toBe(20);
  });

  it("счётчики — максимум, флаги — «или», дата решения — самая ранняя", () => {
    const a: ProgressItem = { attempts: 3, hints: 1, solutionShown: false, solvedAt: 500, at: 1 };
    const b: ProgressItem = { attempts: 1, hints: 3, solutionShown: true, solvedAt: 300, at: 2 };
    const m = mergeItem(a, b);
    expect(m.attempts).toBe(3);
    expect(m.hints).toBe(3);
    expect(m.solutionShown).toBe(true);
    expect(m.solvedAt).toBe(300);
    expect(m.at).toBe(2);
  });

  it("ответы квиза сливаются по вопросам, свежий ответ побеждает", () => {
    const a: ProgressItem = { quiz: { q1: { answer: [0], correct: false, at: 1 }, q2: { answer: [1], correct: true, at: 5 } } };
    const b: ProgressItem = { quiz: { q1: { answer: [2], correct: true, at: 3 }, q3: { answer: [0], correct: true, at: 1 } } };
    const m = mergeItem(a, b);
    expect(m.quiz?.q1.answer).toEqual([2]);
    expect(m.quiz?.q2.answer).toEqual([1]);
    expect(m.quiz?.q3.answer).toEqual([0]);
  });

  it("лучший результат соревнования учитывает направление метрики", () => {
    expect(mergeItem({ best: 3000, lowerIsBetter: true }, { best: 2500 }).best).toBe(2500);
    expect(mergeItem({ best: 0.7, lowerIsBetter: false }, { best: 0.8 }).best).toBe(0.8);
  });

  it("слияние идемпотентно и не зависит от порядка для ключевых полей", () => {
    const a: ProgressItem = { status: "in_progress", attempts: 2, code: "x", codeAt: 5, at: 5 };
    const b: ProgressItem = { status: "solved", attempts: 1, code: "y", codeAt: 7, solvedAt: 7, at: 7 };
    const ab = mergeItem(a, b);
    const ba = mergeItem(b, a);
    expect(ab).toEqual(ba);
    expect(mergeItem(ab, ab)).toEqual(ab);
  });

  it("mergeMaps объединяет словари, countNewlySolved считает перенесённые решения", () => {
    const cloud = { "task:a": { status: "solved" as const }, "task:b": { status: "in_progress" as const } };
    const guest = { "task:b": { status: "solved" as const }, "task:c": { status: "solved" as const }, "lesson:x": { theoryRead: true } };
    expect(countNewlySolved(cloud, guest)).toBe(2);
    const m = mergeMaps(cloud, guest);
    expect(Object.keys(m).sort()).toEqual(["lesson:x", "task:a", "task:b", "task:c"]);
    expect(m["task:b"].status).toBe("solved");
  });
});

describe("экспорт / импорт прогресса", () => {
  it("файл экспорта читается обратно", () => {
    const items = { "task:a": { status: "solved" as const, code: "print(1)" } };
    const parsed = parseImport(JSON.stringify(makeExport(items)));
    expect(parsed).toEqual(items);
  });
  it("чужой JSON отклоняется с понятным сообщением", () => {
    expect(() => parseImport("{\"a\":1}")).toThrow(/не файл прогресса/);
    expect(() => parseImport("не json")).toThrow(/не похож на JSON/);
  });
  it("лишние ключи отбрасываются", () => {
    const text = JSON.stringify({ format: "ds-course-progress", version: 1, items: { "task:a": { status: "solved" }, "evil": { x: 1 } } });
    expect(Object.keys(parseImport(text))).toEqual(["task:a"]);
  });
});
