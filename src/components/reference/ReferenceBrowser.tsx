"use client";
// Поиск по справочнику: используется на странице /reference и в выдвижной панели урока.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReferenceEntry } from "@/lib/content/reference";
import { decodeHash } from "@/lib/url";

function norm(s: string) {
  return s.toLowerCase().replace(/ё/g, "е").trim();
}

function subscribeHash(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}
const readHash = () => decodeHash(window.location.hash);

export function ReferenceList({ entries, compact = false, initialQuery = "" }: { entries: ReferenceEntry[]; compact?: boolean; initialQuery?: string }) {
  const [q, setQ] = useState(initialQuery);
  const [cat, setCat] = useState<string>("");
  const [chosenId, setOpenId] = useState<string | null>(null);
  const categories = useMemo(() => Array.from(new Set(entries.map((e) => e.category))), [entries]);
  const hash = useSyncExternalStore(subscribeHash, readHash, () => "");
  const hashId = !compact && hash && entries.some((e) => e.id === hash) ? hash : null;
  const openId = chosenId ?? hashId;

  useEffect(() => {
    if (hashId) document.getElementById(`ref-${hashId}`)?.scrollIntoView({ block: "start" });
  }, [hashId]);

  const filtered = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    return entries.filter((e) => (!cat || e.category === cat) && words.every((w) => e.searchText.includes(w)));
  }, [entries, q, cat]);

  // при точном совпадении названия — показываем статью первой
  const sorted = useMemo(() => {
    const nq = norm(q);
    if (!nq) return filtered;
    return [...filtered].sort((a, b) => {
      const sa = norm(a.term).startsWith(nq) || a.aliases.some((x) => norm(x).startsWith(nq)) ? 0 : 1;
      const sb = norm(b.term).startsWith(nq) || b.aliases.some((x) => norm(x).startsWith(nq)) ? 0 : 1;
      return sa - sb;
    });
  }, [filtered, q]);

  return (
    <div>
      <div className={`flex flex-col gap-2 ${compact ? "" : "sm:flex-row"}`}>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск: медиана, loc, train_test_split, маска…"
          className="w-full rounded-lg border border-line-strong bg-elev px-3 py-2 text-[0.95rem] outline-none focus:border-accent"
          aria-label="Поиск по справочнику"
          data-testid="reference-search"
          autoFocus={compact}
        />
        <select
          value={cat}
          onChange={(e) => setCat(e.target.value)}
          className="rounded-lg border border-line-strong bg-elev px-3 py-2 text-[0.95rem]"
          aria-label="Раздел справочника"
        >
          <option value="">Все разделы</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <p className="mt-2 text-xs text-muted">Найдено: {sorted.length}</p>
      <ul className="mt-2 space-y-2" data-testid="reference-results">
        {sorted.map((e) => {
          const open = openId === e.id || (sorted.length <= 2 && q.length > 1);
          return (
            <li key={e.id} id={`ref-${e.id}`} className="scroll-mt-20 paper">
              <button
                type="button"
                className="flex w-full items-start gap-2 px-3 py-2.5 text-left"
                onClick={() => setOpenId(open ? null : e.id)}
                aria-expanded={open}
              >
                <span className="font-mono text-[0.95rem] font-semibold text-ink">{e.term}</span>
                <span className="ml-auto shrink-0 rounded-full bg-soft px-2 py-0.5 text-[11px] text-muted">{e.category}</span>
              </button>
              {open && (
                <div className="space-y-2 border-t border-line px-3 py-3 text-sm">
                  <div className="md" dangerouslySetInnerHTML={{ __html: e.summaryHtml }} />
                  {e.syntaxHtml && (
                    <div>
                      <p className="mb-1 text-xs font-semibold text-muted">Синтаксис</p>
                      <pre className="code-block" dangerouslySetInnerHTML={{ __html: e.syntaxHtml }} />
                    </div>
                  )}
                  {e.exampleHtml && (
                    <div>
                      <p className="mb-1 text-xs font-semibold text-muted">Пример</p>
                      <pre className="code-block" dangerouslySetInnerHTML={{ __html: e.exampleHtml }} />
                    </div>
                  )}
                  {e.lessons.length > 0 && (
                    <p className="text-xs text-muted">
                      В уроках:{" "}
                      {e.lessons.map((l, i) => (
                        <span key={l.id}>
                          {i > 0 && ", "}
                          <Link href={l.href} className="text-accent-ink underline">
                            {l.number} {l.title}
                          </Link>
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Кнопка «Справочник» и выдвижная панель в уроке (данные загружаются при первом открытии). */
export function ReferencePanelButton() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<ReferenceEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || entries) return;
    fetch("/api/reference")
      .then((r) => r.json())
      .then((d) => setEntries(d as ReferenceEntry[]))
      .catch(() => setErr("Не удалось загрузить справочник."));
  }, [open, entries]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="no-print fixed bottom-4 right-4 z-30 flex h-11 w-11 items-center justify-center gap-1.5 rounded-full border border-line-strong bg-elev text-sm font-medium shadow-lg hover:bg-soft sm:h-auto sm:w-auto sm:px-4 sm:py-2.5"
        data-testid="open-reference"
        aria-label="Открыть справочник"
        title="Справочник"
      >
        <span aria-hidden="true">📖</span>
        <span className="hidden sm:inline">Справочник</span>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Справочник">
          <div ref={panelRef} className="h-full w-full max-w-md overflow-y-auto border-l border-line bg-bg p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center">
              <h2 className="text-lg font-semibold">Справочник</h2>
              <button type="button" className="ml-auto rounded-lg px-2 py-1 text-muted hover:bg-soft" onClick={() => setOpen(false)} aria-label="Закрыть справочник">
                ✕
              </button>
            </div>
            {err && <p className="text-sm text-bad">{err}</p>}
            {!entries && !err && <p className="text-sm text-muted">Загружаем…</p>}
            {entries && <ReferenceList entries={entries} compact />}
          </div>
        </div>
      )}
    </>
  );
}
