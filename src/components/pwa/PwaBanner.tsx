"use client";
// Полоски под шапкой: «нет интернета» (на всех страницах) и подсказка установить курс как приложение
// (на телефоне, на главной и в оглавлении; после «Не сейчас» больше не показывается).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { promptInstall, useInstall, useOnline, usePlatform, useStandalone } from "@/lib/pwa/client";

const HINT_KEY = "dsc.pwa.hintDismissed";
const HINT_PAGES = new Set(["/", "/course", "/courses"]);

const hintListeners = new Set<() => void>();
function hintDismissed(): boolean {
  try {
    return window.localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
}
function dismissHint() {
  try {
    window.localStorage.setItem(HINT_KEY, "1");
  } catch {
    /* хранилище недоступно — подсказка скроется до перезагрузки */
  }
  hiddenThisVisit = true;
  hintListeners.forEach((l) => l());
}
let hiddenThisVisit = false;

function useHintDismissed(): boolean {
  return useSyncExternalStore(
    (l) => {
      hintListeners.add(l);
      return () => hintListeners.delete(l);
    },
    () => hiddenThisVisit || hintDismissed(),
    () => true
  );
}

export function PwaBanner() {
  const online = useOnline();
  const pathname = usePathname();
  const platform = usePlatform();
  const standalone = useStandalone();
  const { canPrompt, installed } = useInstall();
  const dismissed = useHintDismissed();

  if (!online) {
    return (
      <div className="no-print border-b border-line bg-warn-soft" role="status" data-testid="offline-banner">
        <p className="mx-auto max-w-5xl px-4 py-2 text-sm text-warn sm:px-8">
          Нет интернета. Работают сохранённые на устройстве уроки; решения сохранятся и отправятся, когда сеть появится.
        </p>
      </div>
    );
  }

  const mobile = platform?.os === "ios" || platform?.os === "android";
  if (!platform || !mobile || standalone || installed || dismissed || !HINT_PAGES.has(pathname)) return null;

  return (
    <div className="no-print border-b border-line bg-accent-soft" data-testid="install-hint" data-os={platform.os}>
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:gap-4 sm:px-8">
        <p className="min-w-0 sm:flex-1">
          {platform.os === "ios" ? (
            <>
              Установите курс на {/iPad|Macintosh/.test(navigator.userAgent) ? "iPad" : "iPhone"} как приложение: «Поделиться»{" "}
              <ShareIcon /> → «На экран „Домой“». Уроки будут открываться и без интернета.
            </>
          ) : (
            <>Установите курс на телефон как приложение: иконка на экране и уроки без интернета.</>
          )}
        </p>
        <div className="flex items-center gap-4">
          {canPrompt ? (
            <button
              type="button"
              className="rounded-md bg-accent px-3 py-1.5 font-semibold text-white dark:text-[#0f1726]"
              onClick={() => void promptInstall()}
              data-testid="install-hint-button"
            >
              Установить
            </button>
          ) : (
            <Link href="/app" className="font-semibold text-accent-ink underline" data-testid="install-hint-more">
              Как установить
            </Link>
          )}
          <button type="button" className="text-muted underline" onClick={dismissHint} data-testid="install-hint-dismiss">
            Не сейчас
          </button>
        </div>
      </div>
    </div>
  );
}

/** Значок «Поделиться» из Safari: квадрат со стрелкой вверх. */
export function ShareIcon() {
  return (
    <svg
      className="inline-block align-[-0.2em]"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="значок «Поделиться»"
      role="img"
    >
      <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M6 11H5v10h14V11h-1" />
    </svg>
  );
}
