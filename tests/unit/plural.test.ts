import { describe, expect, it } from "vitest";
import { LESSON, plural, pluralWord, TASK } from "../../src/lib/plural";

describe("plural — форма слова после числа", () => {
  it("1, 21, 101 — именительный падеж единственного числа", () => {
    expect(plural(1, LESSON)).toBe("1 урок");
    expect(plural(21, TASK)).toBe("21 задание");
    expect(plural(61, TASK)).toBe("61 задание");
    expect(plural(101, TASK)).toBe("101 задание");
  });

  it("2–4, 22–24 — родительный падеж единственного числа", () => {
    expect(plural(2, LESSON)).toBe("2 урока");
    expect(plural(34, TASK)).toBe("34 задания");
    expect(plural(63, TASK)).toBe("63 задания");
  });

  it("0, 5–20 и 11–14 в любой сотне — родительный падеж множественного числа", () => {
    expect(plural(0, TASK)).toBe("0 заданий");
    expect(plural(11, LESSON)).toBe("11 уроков");
    expect(plural(14, TASK)).toBe("14 заданий");
    expect(plural(111, TASK)).toBe("111 заданий");
    expect(plural(539, TASK)).toBe("539 заданий");
    expect(pluralWord(90, LESSON)).toBe("уроков");
  });
});
