"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { TaskIndexItem } from "@/lib/content/types";
import { useAllProgress } from "@/lib/progress/store";
import { taskKey } from "@/lib/progress/stats";
import { Badge, DIFFICULTY_LABEL, KIND_LABEL, StatusDot } from "../ui";

const STATUS_LABEL: Record<string, string> = { not_started: "Не начато", in_progress: "В процессе", solved: "Решено" };

export function TaskBrowser({ tasks, modules, lessonTitles }: { tasks: TaskIndexItem[]; modules: { id: string; label: string }[]; lessonTitles: Record<string, string> }) {
  const items = useAllProgress();
  const [mod, setMod] = useState("");
  const [diff, setDiff] = useState("");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const nq = q.toLowerCase().replace(/ё/g, "е");
    return tasks
      .map((t) => ({ ...t, status: items[taskKey(t.id)]?.status ?? "not_started" }))
      .filter(
        (t) =>
          (!mod || t.moduleId === mod) &&
          (!diff || t.difficulty === diff) &&
          (!kind || t.kind === kind) &&
          (!status || t.status === status) &&
          (!nq || t.title.toLowerCase().replace(/ё/g, "е").includes(nq))
      );
  }, [tasks, items, mod, diff, kind, status, q]);

  const solved = rows.filter((r) => r.status === "solved").length;
  const select = "rounded-lg border border-line-strong bg-elev px-3 py-2 text-sm";

  return (
    <div className="mt-6">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по названию" className={`${select} lg:col-span-1`} aria-label="Поиск задач" />
        <select value={mod} onChange={(e) => setMod(e.target.value)} className={select} aria-label="Модуль" data-testid="filter-module">
          <option value="">Все модули</option>
          {modules.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <select value={diff} onChange={(e) => setDiff(e.target.value)} className={select} aria-label="Сложность" data-testid="filter-difficulty">
          <option value="">Любая сложность</option>
          {Object.entries(DIFFICULTY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={select} aria-label="Тип задания">
          <option value="">Любой тип</option>
          {Object.entries(KIND_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={select} aria-label="Статус" data-testid="filter-status">
          <option value="">Любой статус</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <p className="mt-3 text-sm text-muted" data-testid="tasks-count">
        Показано: {rows.length} · решено из них: {solved}
      </p>
      <ul className="mt-3 divide-y divide-line paper">
        {rows.map((t) => (
          <li key={t.id}>
            <Link href={t.href} className="flex items-center gap-3 px-3 py-2.5 hover:bg-soft" data-testid="task-row" data-status={t.status}>
              <StatusDot status={t.status} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{t.title}</span>
                <span className="block truncate text-xs text-muted">{lessonTitles[t.lessonId]}</span>
              </span>
              <span className="hidden shrink-0 gap-1.5 sm:flex">
                <Badge tone={t.difficulty === "star" ? "accent" : t.difficulty === "warmup" ? "info" : "neutral"}>{DIFFICULTY_LABEL[t.difficulty]}</Badge>
                {t.kind !== "code" && <Badge tone="accent">{KIND_LABEL[t.kind]}</Badge>}
              </span>
            </Link>
          </li>
        ))}
        {!rows.length && <li className="px-3 py-6 text-center text-sm text-muted">Ничего не найдено — измените фильтры.</li>}
      </ul>
    </div>
  );
}
