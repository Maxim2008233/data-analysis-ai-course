"use client";
// Боковая навигация «лабораторного журнала»: разделы, модули с клетками прогресса, тема, аккаунт.
// На телефоне — верхняя полоса и выдвижная панель.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ModuleIndexItem } from "@/lib/content/types";
import { useAuth } from "@/lib/auth/AuthProvider";
import { progressStore, useAllProgress, useProgressVersion } from "@/lib/progress/store";
import { lessonStatus } from "@/lib/progress/stats";
import { REPORT_BUG_URL } from "@/lib/config";
import { ThemeToggle } from "./ThemeToggle";

export type SidebarModule = Pick<ModuleIndexItem, "id" | "slug" | "number" | "label" | "short" | "kind" | "lessons">;

export function BrandMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <rect x="1" y="1" width="38" height="38" rx="8" fill="var(--accent)" />
      <g stroke="var(--bg-elev)" strokeOpacity="0.35" strokeWidth="1">
        <path d="M8 31H33M8 31V8" />
      </g>
      <path d="M9 28 L16 21 L22 24 L31 12" fill="none" stroke="var(--warm)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="21" r="2.4" fill="var(--bg-elev)" />
      <circle cx="22" cy="24" r="2.4" fill="var(--bg-elev)" />
      <circle cx="31" cy="12" r="2.4" fill="var(--bg-elev)" />
    </svg>
  );
}

const NAV = [
  { href: "/courses", label: "Курсы", hint: "программа и мини-курсы", icon: "M4 5h7v14H4zM13 5h7v14h-7z" },
  { href: "/tasks", label: "Задачи", hint: "все задания с фильтрами", icon: "M9 4h6l1 3h3v13H5V7h3zM9 13l2 2 4-4" },
  { href: "/reference", label: "Справочник", hint: "термины и функции", icon: "M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4zM9 8h6M9 12h6" },
  { href: "/profile", label: "Профиль", hint: "прогресс и аккаунт", icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" },
  { href: "/app", label: "Приложение", hint: "установка и офлайн", icon: "M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM12 7v7M9 11l3 3 3-3M10 18h4" },
];

function Icon({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function SyncLine() {
  useProgressVersion();
  const pending = progressStore.pendingCount();
  const s = progressStore.syncStatus === "idle" && pending > 0 ? "syncing" : progressStore.syncStatus;
  const map: Record<string, { text: string; cls: string }> = {
    guest: { text: "Прогресс хранится в этом браузере", cls: "text-muted" },
    idle: { text: "Сохранено в облаке", cls: "text-ok" },
    syncing: { text: "Сохраняем…", cls: "text-muted" },
    offline: { text: "Нет сети — сохраним позже", cls: "text-warn" },
    error: { text: "Ошибка синхронизации — повторим", cls: "text-warn" },
  };
  const m = map[s];
  return (
    <p className={`text-xs ${m.cls}`} data-testid="sync-status" data-status={s} data-pending={pending}>
      {m.text}
    </p>
  );
}

function ModuleList({ modules, pathname }: { modules: SidebarModule[]; pathname: string }) {
  const items = useAllProgress();
  return (
    <ol className="space-y-0.5">
      {modules.map((m) => {
        const active = pathname.startsWith(`/learn/${m.slug}/`) || pathname === `/course/${m.slug}`;
        const statuses = m.lessons.map((l) => lessonStatus(l, items));
        return (
          <li key={m.id}>
            <Link
              href={`/course/${m.slug}`}
              className={`group flex items-start gap-2.5 rounded-md px-2 py-1.5 ${active ? "bg-elev shadow-[var(--shadow)]" : "hover:bg-elev/60"}`}
            >
              <span className="mt-0.5 w-7 shrink-0 font-display text-sm font-semibold text-warm-ink tabular-nums">
                {m.kind === "module" ? String(m.number).padStart(2, "0") : m.kind === "checkpoint" ? "КТ" : m.kind === "competition" ? "★" : "+"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.9rem] leading-snug text-ink">{m.short}</span>
                <span className="cells mt-1">
                  {statuses.map((s, i) => (
                    <span key={i} className={`cell ${s === "solved" ? "solved" : s === "in_progress" ? "progress" : ""}`} style={{ width: 7, height: 7 }} />
                  ))}
                </span>
              </span>
            </Link>
            {active && (
              <ol className="mb-2 ml-9 mt-1 space-y-0.5 border-l border-line pl-2">
                {m.lessons.map((l, i) => {
                  const cur = pathname === l.href;
                  const st = statuses[i];
                  return (
                    <li key={l.id}>
                      <Link
                        href={l.href}
                        className={`flex items-start gap-2 rounded px-1.5 py-1 text-[0.82rem] leading-snug ${cur ? "bg-accent-soft font-medium text-accent-ink" : "text-muted hover:text-ink"}`}
                        aria-current={cur ? "page" : undefined}
                      >
                        <span className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${st === "solved" ? "bg-ok" : st === "in_progress" ? "bg-warm" : "border border-line-strong"}`} />
                        <span className="min-w-0">
                          <span className="tabular-nums">{l.number}</span> {l.title}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function SidebarBody({ modules, pathname }: { modules: SidebarModule[]; pathname: string }) {
  const { user, username, enabled, ready } = useAuth();
  return (
    <div className="flex h-full flex-col">
      <Link href="/" className="flex items-center gap-3 px-4 pb-4 pt-5" aria-label="На главную">
        <BrandMark />
        <span className="leading-tight">
          <span className="block font-display text-[1.05rem] font-semibold text-ink">Лаборатория данных</span>
          <span className="block text-xs text-muted">курс «Анализ данных и ИИ»</span>
        </span>
      </Link>
      <nav className="px-2" aria-label="Разделы сайта">
        {NAV.map((n) => {
          const active = pathname === n.href || pathname.startsWith(n.href + "/") || (n.href === "/courses" && pathname.startsWith("/course"));
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`flex items-center gap-3 rounded-md px-2.5 py-2 ${active ? "bg-elev text-ink shadow-[var(--shadow)]" : "text-muted hover:bg-elev/60 hover:text-ink"}`}
            >
              <span className={active ? "text-warm" : ""}>
                <Icon d={n.icon} />
              </span>
              <span className="text-[0.95rem] font-medium">{n.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="mt-5 px-4">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted">Программа</p>
      </div>
      <div className="mt-1.5 flex-1 overflow-y-auto px-2 pb-4">
        <ModuleList modules={modules} pathname={pathname} />
      </div>
      <div className="space-y-2 border-t border-line px-4 py-3">
        <SyncLine />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <a href={REPORT_BUG_URL} target="_blank" rel="noreferrer" className="text-sm text-muted hover:text-ink" data-testid="report-bug">
            Нашли ошибку?
          </a>
        </div>
        {enabled && ready && (
          user ? (
            // в углу — логин, а не почта; у аккаунтов, созданных до логинов, — приглашение его придумать
            username === null ? (
              <Link href="/profile#login" className="block truncate text-sm font-semibold text-accent-ink hover:underline" data-testid="profile-link">
                Придумайте логин
              </Link>
            ) : (
              <Link href="/profile" className="block truncate text-sm text-accent-ink hover:underline" data-testid="profile-link" title="Профиль">
                {username ?? "Профиль"}
              </Link>
            )
          ) : (
            <Link href="/login" className="inline-flex rounded-md bg-ok px-3 py-1.5 text-sm font-semibold text-white dark:text-[#0e1a13]" data-testid="login-link">
              Войти или зарегистрироваться
            </Link>
          )
        )}
      </div>
    </div>
  );
}

export function Sidebar({ modules }: { modules: SidebarModule[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* телефон и планшет: верхняя полоса */}
      <header className="no-print sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-line bg-side/95 px-4 backdrop-blur lg:hidden">
        <Link href="/" className="flex items-center gap-2.5" aria-label="На главную">
          <BrandMark size={30} />
          <span className="font-display font-semibold">Лаборатория данных</span>
        </Link>
        <button
          type="button"
          className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-md border border-line-strong"
          onClick={() => setOpen(true)}
          aria-label="Открыть меню"
          aria-expanded={open}
          data-testid="mobile-menu"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 lg:hidden" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Меню">
          <div
            className="graph-paper h-full w-[86%] max-w-xs overflow-y-auto bg-side"
            onClick={(e) => {
              e.stopPropagation();
              if ((e.target as HTMLElement).closest("a")) setOpen(false);
            }}
          >
            <SidebarBody modules={modules} pathname={pathname} />
          </div>
        </div>
      )}
      {/* компьютер: постоянная боковая панель */}
      <aside className="no-print graph-paper sticky top-0 hidden h-screen border-r border-line bg-side lg:block" aria-label="Навигация">
        <SidebarBody modules={modules} pathname={pathname} />
      </aside>
    </>
  );
}
