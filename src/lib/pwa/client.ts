"use client";
// Состояние приложения в браузере: можно ли установить сайт как приложение, открыт ли он как приложение,
// есть ли интернет, какое устройство. Chrome, Edge, Samsung Internet и Яндекс Браузер присылают событие
// beforeinstallprompt — сохраняем его и показываем свою кнопку «Установить». Safari (iPhone, iPad, Mac)
// такого события не присылает: там показываем инструкцию «Поделиться → На экран „Домой“».
import { useSyncExternalStore } from "react";
import { detectPlatform, type PlatformInfo } from "./platform";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
}

declare global {
  interface Window {
    /** Событие установки, пойманное до загрузки React (installCaptureScript, src/lib/pwa/install-script.ts). */
    __dscInstallPrompt?: Event | null;
  }
}

interface InstallState {
  canPrompt: boolean;
  installed: boolean;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installState: InstallState = { canPrompt: false, installed: false };
const installListeners = new Set<() => void>();
let installStarted = false;

function setInstall(patch: Partial<InstallState>) {
  installState = { ...installState, ...patch };
  installListeners.forEach((l) => l());
}

/** Начать следить за событиями установки (один раз, из PwaRegister). */
export function initInstallEvents() {
  if (installStarted || typeof window === "undefined") return;
  installStarted = true;
  const take = (e: Event | null | undefined) => {
    if (!e) return;
    deferred = e as BeforeInstallPromptEvent;
    window.__dscInstallPrompt = null;
    setInstall({ canPrompt: true });
  };
  take(window.__dscInstallPrompt);
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    take(e);
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    setInstall({ canPrompt: false, installed: true });
  });
}

/** Показать системный диалог установки (Android, Chrome и Edge на компьютере). */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const e = deferred;
  if (!e) return "unavailable";
  deferred = null;
  setInstall({ canPrompt: false });
  try {
    await e.prompt();
    const choice = await e.userChoice;
    if (choice.outcome === "accepted") setInstall({ installed: true });
    return choice.outcome;
  } catch {
    return "unavailable";
  }
}

const SERVER_INSTALL: InstallState = { canPrompt: false, installed: false };
export function useInstall(): InstallState {
  return useSyncExternalStore(
    (l) => {
      installListeners.add(l);
      return () => installListeners.delete(l);
    },
    () => installState,
    () => SERVER_INSTALL
  );
}

// --- открыт ли сайт как приложение ---
function standaloneNow(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches === true || nav.standalone === true;
}

export function useStandalone(): boolean {
  return useSyncExternalStore(
    (l) => {
      const mq = window.matchMedia?.("(display-mode: standalone)");
      mq?.addEventListener?.("change", l);
      return () => mq?.removeEventListener?.("change", l);
    },
    standaloneNow,
    () => false
  );
}

// --- есть ли интернет ---
export function useOnline(): boolean {
  return useSyncExternalStore(
    (l) => {
      window.addEventListener("online", l);
      window.addEventListener("offline", l);
      return () => {
        window.removeEventListener("online", l);
        window.removeEventListener("offline", l);
      };
    },
    () => navigator.onLine !== false,
    () => true
  );
}

// --- устройство (на сервере неизвестно: null, пока страница не загрузилась в браузере) ---
let platformCache: PlatformInfo | null = null;
function platformNow(): PlatformInfo {
  if (!platformCache) {
    platformCache = detectPlatform({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints ?? 0 });
  }
  return platformCache;
}

export function usePlatform(): PlatformInfo | null {
  return useSyncExternalStore(
    () => () => {},
    platformNow,
    () => null
  );
}
