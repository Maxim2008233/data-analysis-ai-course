"use client";
// Содержимое страницы «Нет подключения»: какие уроки сохранены на устройстве и кнопка «Попробовать снова».
// Ссылки — обычные <a>: без сети переход внутри сайта (через данные Next.js) всё равно не удастся,
// а обычный переход сразу отдаст сохранённую страницу.
import { useEffect, useState } from "react";
import { safeNext } from "@/lib/url";
import { listSavedPages } from "@/lib/pwa/offline";

export interface OfflineModule {
  label: string;
  title: string;
  href: string;
  lessons: { number: string; title: string; href: string }[];
}

export function OfflineClient({ modules }: { modules: OfflineModule[] }) {
  const [saved, setSaved] = useState<Set<string> | null>(null);
  const [from, setFrom] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listSavedPages().then((pages) => {
      if (!active) return;
      setSaved(new Set(pages));
      // какую страницу открывали: /offline?from=/learn/… (подставляет service worker)
      const raw = new URLSearchParams(window.location.search).get("from");
      setFrom(raw ? safeNext(raw) : null);
    });
    return () => {
      active = false;
    };
  }, []);

  const savedModules = saved
    ? modules
        .map((m) => ({ ...m, lessons: m.lessons.filter((l) => saved.has(l.href)) }))
        .filter((m) => m.lessons.length > 0)
    : [];
  const savedCount = savedModules.reduce((n, m) => n + m.lessons.length, 0);

  return (
    <div data-testid="offline-page">
      <p className="mt-4 leading-relaxed text-muted">
        Эта страница ещё не сохранена на устройстве. Уроки, которые вы уже открывали, работают и без интернета — вместе с запуском
        кода, если Python успел загрузиться. Чтобы заниматься без сети всем курсом, скачайте его заранее на странице{" "}
        <a href="/app" className="text-accent-ink underline">
          «Приложение»
        </a>
        .
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <a
          href={from ?? "/course"}
          className="rounded-md bg-accent px-4 py-2 font-semibold text-white dark:text-[#0f1726]"
          data-testid="offline-retry"
        >
          Попробовать снова
        </a>
        {/* обычный переход, а не Link: без сети его сразу обслужит service worker сохранённой страницей */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/course" className="rounded-md border border-line-strong px-4 py-2 font-medium">
          Оглавление курса
        </a>
      </div>

      <h2 className="mt-9 font-display text-xl font-semibold">Сохранённые уроки</h2>
      {saved === null ? (
        <p className="mt-2 text-sm text-muted">Проверяем…</p>
      ) : savedCount === 0 ? (
        <p className="mt-2 text-sm text-muted" data-testid="offline-none">
          На этом устройстве пока нет сохранённых уроков.
        </p>
      ) : (
        <div className="mt-3 space-y-4" data-testid="offline-saved">
          {savedModules.map((m) => (
            <section key={m.href} className="paper p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{m.label}</p>
              <p className="font-display font-semibold">{m.title}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {m.lessons.map((l) => (
                  <li key={l.href}>
                    <a href={l.href} className="text-accent-ink hover:underline" data-testid="offline-lesson">
                      {l.number}. {l.title}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
