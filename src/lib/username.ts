// Логин ученика: латиница, 3–20 символов, начинается с буквы. Те же правила проверяет база
// (ограничение profiles_username_format в миграции 20261121000002_usernames.sql).

export const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{2,19}$/;

export const USERNAME_RULES = "3–20 символов: латинские буквы, цифры, «_», «.», «-»; начинается с буквы.";

/** Пустая строка — логина нет; иначе текст ошибки по-русски или null, если логин подходит. */
export function usernameError(raw: string): string | null {
  const s = raw.trim();
  if (!s) return "Придумайте логин.";
  if (s.length < 3) return "Логин слишком короткий: нужно не меньше 3 символов.";
  if (s.length > 20) return "Логин слишком длинный: не больше 20 символов.";
  if (!/^[A-Za-z]/.test(s)) return "Логин должен начинаться с латинской буквы.";
  if (!USERNAME_PATTERN.test(s)) return "В логине можно использовать латинские буквы, цифры и символы «_», «.», «-».";
  return null;
}

/** Похоже ли введённое при входе на почту (иначе это логин: в логине нет «@»). */
export function looksLikeEmail(identifier: string): boolean {
  return identifier.includes("@");
}
