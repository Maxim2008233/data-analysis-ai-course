import type { Metadata } from "next";
import { AppClient } from "@/components/pwa/AppClient";

export const metadata: Metadata = {
  title: "Приложение и офлайн",
  description: "Как установить курс на телефон или компьютер как приложение и заниматься без интернета.",
};

export default function AppPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <p className="font-display text-lg italic text-warm-ink">Телефон, планшет, компьютер</p>
      <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight">Приложение и офлайн</h1>
      <p className="mt-3 leading-relaxed text-muted">
        Курс можно установить как приложение: иконка на экране, отдельное окно без панелей браузера и уроки без интернета —
        вместе с Python и заданиями с автопроверкой.
      </p>
      <AppClient />
    </div>
  );
}
