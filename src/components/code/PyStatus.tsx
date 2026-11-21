"use client";
import { usePyState } from "@/lib/py/client";

/** Строка состояния Python: «Готовим Python…», «Загружаем библиотеки…», «Выполняется…». */
export function PyStatus() {
  const s = usePyState();
  const text = s.phase === "loading" ? s.text || "Готовим Python…" : s.phase === "running" ? "Выполняется…" : "Ждём очереди…";
  return (
    <p className="flex items-center gap-2 text-xs text-muted" role="status" data-testid="py-status">
      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-hidden="true" />
      {text}
      {s.phase === "loading" && s.generation <= 1 && <span className="hidden sm:inline">(первый запуск загружает Python ~10–30 МБ, дальше — из кэша)</span>}
      {s.phase === "loading" && s.memoryRestart && <span data-testid="py-memory-restart">— Python перезапущен, чтобы освободить память</span>}
    </p>
  );
}
