// Перенаправление после входа только внутри сайта и разбор хэша без падений.
import { describe, expect, it } from "vitest";
import { decodeHash, safeNext } from "@/lib/url";

describe("safeNext: перенаправление после входа", () => {
  it("пропускает пути этого сайта вместе с параметрами и хэшем", () => {
    expect(safeNext("/profile")).toBe("/profile");
    expect(safeNext("/learn/m01-numpy/l02-ndarray?x=1#step-3")).toBe("/learn/m01-numpy/l02-ndarray?x=1#step-3");
    expect(safeNext("/курс")).toBe("/%D0%BA%D1%83%D1%80%D1%81");
  });

  it("без параметра — страница курса или заданный запасной путь", () => {
    expect(safeNext(null)).toBe("/course");
    expect(safeNext(undefined)).toBe("/course");
    expect(safeNext("")).toBe("/course");
    expect(safeNext(null, "/profile")).toBe("/profile");
  });

  it.each([
    "https://example.org/phish",
    "http://example.org",
    "//example.org/phish",
    "/\\example.org/phish",
    "\\\\example.org",
    "/\t/example.org",
    "/\n/example.org",
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "example.org",
    " /profile",
  ])("отбрасывает адрес на другой сайт или схему: %j", (raw) => {
    expect(safeNext(raw)).toBe("/course");
  });
});

describe("decodeHash: хэш адреса", () => {
  it("раскодирует обычный хэш", () => {
    expect(decodeHash("#step-3")).toBe("step-3");
    expect(decodeHash("#%D1%88%D0%B0%D0%B3")).toBe("шаг");
    expect(decodeHash("")).toBe("");
  });

  it("испорченная кодировка не бросает ошибку", () => {
    expect(() => decodeHash("#%E0%A4%A")).not.toThrow();
    expect(decodeHash("#%E0%A4%A")).toBe("%E0%A4%A");
    expect(decodeHash("#%")).toBe("%");
  });
});
