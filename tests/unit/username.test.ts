// Правила логина: латиница, 3–20 символов, начинается с буквы; вход по логину или по почте.
import { describe, expect, it } from "vitest";
import { looksLikeEmail, usernameError, USERNAME_PATTERN } from "@/lib/username";

describe("usernameError", () => {
  it.each(["max", "Maxim2008", "data_lab", "a.b-c_1", "x".repeat(20)])("подходит: %s", (name) => {
    expect(usernameError(name)).toBeNull();
    expect(USERNAME_PATTERN.test(name)).toBe(true);
  });

  it("пробелы по краям не мешают", () => {
    expect(usernameError("  maxim  ")).toBeNull();
  });

  it.each([
    ["", "Придумайте логин."],
    ["ab", "слишком короткий"],
    ["x".repeat(21), "слишком длинный"],
    ["2maxim", "начинаться с латинской буквы"],
    ["_maxim", "начинаться с латинской буквы"],
    ["Максим", "начинаться с латинской буквы"],
    ["max im", "латинские буквы, цифры"],
    ["maxim@mail", "латинские буквы, цифры"],
    ["maxіm", "латинские буквы, цифры"],
    ["<b>x</b>", "начинаться с латинской буквы"],
  ])("не подходит: %j", (name, msg) => {
    expect(usernameError(name)).toContain(msg);
  });
});

describe("looksLikeEmail", () => {
  it("почта — с «@», логин — без", () => {
    expect(looksLikeEmail("student@example.com")).toBe(true);
    expect(looksLikeEmail("maxim2008")).toBe(false);
  });
});
