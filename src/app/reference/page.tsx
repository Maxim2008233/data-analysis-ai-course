import type { Metadata } from "next";
import { buildReferenceData } from "@/lib/content/reference";
import { ReferenceList } from "@/components/reference/ReferenceBrowser";

export const metadata: Metadata = { title: "Справочник" };

export default function ReferencePage() {
  const entries = buildReferenceData();
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="font-display text-4xl font-semibold tracking-tight">Справочник</h1>
      <p className="mt-2 text-muted">
        Термины и функции курса: NumPy, Pandas, визуализация, статистика, машинное обучение, метрики, LLM. У каждой статьи — суть, синтаксис, пример и ссылки на уроки.
      </p>
      <div className="mt-6">
        <ReferenceList entries={entries} />
      </div>
    </div>
  );
}
