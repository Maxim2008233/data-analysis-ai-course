import type { Metadata } from "next";
import { buildCourseIndex, loadCourse } from "@/lib/content/load";
import { OfflineClient, type OfflineModule } from "@/components/pwa/OfflineClient";

// Страница «Нет подключения»: её показывает service worker (public/sw.js), когда интернета нет,
// а открываемая страница ещё не сохранена на устройстве. Сохраняется при установке service worker'а.
export const metadata: Metadata = { title: "Нет подключения", robots: { index: false } };

export default function OfflinePage() {
  const index = buildCourseIndex(loadCourse());
  const modules: OfflineModule[] = index.modules.map((m) => ({
    label: m.label,
    title: m.title,
    href: `/course/${m.slug}`,
    lessons: m.lessons.map((l) => ({ number: l.number, title: l.title, href: l.href })),
  }));
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <p className="font-display text-lg italic text-warm-ink">Офлайн-режим</p>
      <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Нет подключения к интернету</h1>
      <OfflineClient modules={modules} />
    </div>
  );
}
