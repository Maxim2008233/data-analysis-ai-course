// На каком устройстве открыт сайт: от этого зависят подсказка об установке приложения и порог памяти Python.
// Чистые функции без обращения к window — их проверяют модульные тесты (tests/unit/pwa.test.ts).

export type OS = "ios" | "android" | "desktop";
export type Browser = "safari" | "chrome" | "edge" | "firefox" | "samsung" | "yandex" | "other";

export interface PlatformInput {
  userAgent: string;
  /** navigator.maxTouchPoints: iPad с iPadOS 13+ представляется компьютером Mac, но у него сенсорный экран. */
  maxTouchPoints?: number;
  /** Открыт ли сайт как установленное приложение (display-mode: standalone или navigator.standalone на iOS). */
  standalone?: boolean;
}

export interface PlatformInfo {
  os: OS;
  browser: Browser;
  standalone: boolean;
}

export function detectPlatform({ userAgent, maxTouchPoints = 0, standalone = false }: PlatformInput): PlatformInfo {
  const ua = userAgent || "";
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  const android = !ios && /Android/i.test(ua);
  let browser: Browser = "other";
  if (ios) {
    // на iPhone все браузеры работают на движке Safari; различаются только меню и кнопки
    if (/CriOS/.test(ua)) browser = "chrome";
    else if (/FxiOS/.test(ua)) browser = "firefox";
    else if (/EdgiOS/.test(ua)) browser = "edge";
    else if (/YaBrowser/.test(ua)) browser = "yandex";
    else if (/Safari/.test(ua) && !/GSA\//.test(ua)) browser = "safari";
  } else if (/YaBrowser/.test(ua)) browser = "yandex";
  else if (/SamsungBrowser/.test(ua)) browser = "samsung";
  else if (/Edg\//.test(ua)) browser = "edge";
  else if (/Firefox\//.test(ua)) browser = "firefox";
  else if (/Chrome\//.test(ua) || /Chromium\//.test(ua)) browser = "chrome";
  else if (/Safari\//.test(ua)) browser = "safari";
  return { os: ios ? "ios" : android ? "android" : "desktop", browser, standalone };
}

/**
 * Порог памяти Python (МБ) для устройства: на телефонах, планшетах и компьютерах с маленькой памятью
 * (navigator.deviceMemory ≤ 4 ГБ, его сообщают Chrome и Edge) — пониже, чтобы вкладку не закрыла система.
 */
export function pyMemoryLimitMb(os: OS, deviceMemory: number | undefined, desktopMb: number, mobileMb: number): number {
  if (os === "ios" || os === "android") return mobileMb;
  if (typeof deviceMemory === "number" && deviceMemory > 0 && deviceMemory <= 4) return mobileMb;
  return desktopMb;
}
