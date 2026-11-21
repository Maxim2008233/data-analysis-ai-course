import type { Metadata } from "next";
import { AppClient } from "@/components/pwa/AppClient";

export const metadata: Metadata = {
  title: "Без интернета",
  description: "Как заниматься курсом без интернета: скачать курс на устройство и установить его на телефон как приложение.",
};

export default function AppPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <p className="font-display text-lg italic text-warm-ink">Телефон, планшет, компьютер</p>
      <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight">Без интернета</h1>
      <p className="mt-3 leading-relaxed text-muted">
        Курс работает и без сети — вместе с Python и заданиями с автопроверкой. Открытые уроки сохраняются на устройстве сами,
        весь курс можно скачать заранее, а на телефон — установить как приложение с иконкой на экране.
      </p>
      <AppClient />
    </div>
  );
}
