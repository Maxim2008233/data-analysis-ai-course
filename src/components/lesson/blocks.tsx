// Блоки теории (рендерятся на сервере): заметки на полях, схемы, статичный код.
import type { ReactNode } from "react";

const CALLOUT_STYLE: Record<string, { label: string; cls: string; mark: string }> = {
  tip: { label: "Совет", cls: "border-ok bg-ok-soft/60", mark: "✎" },
  info: { label: "На заметку", cls: "border-info bg-info-soft/60", mark: "i" },
  note: { label: "Заметка", cls: "border-line-strong bg-soft/60", mark: "✎" },
  warning: { label: "Осторожно", cls: "border-warn bg-warn-soft/60", mark: "!" },
  important: { label: "Важно", cls: "border-warm bg-warm-soft/60", mark: "!" },
  mistake: { label: "Типичная ошибка", cls: "border-bad bg-bad-soft/60", mark: "✗" },
  recall: { label: "Вспомним", cls: "border-accent bg-accent-soft/60", mark: "↺" },
  example: { label: "Пример", cls: "border-line-strong bg-soft/60", mark: "→" },
  definition: { label: "Определение", cls: "border-accent bg-accent-soft/60", mark: "≡" },
};

export function Callout({ kind, title, children }: { kind: string; title?: string; children?: ReactNode }) {
  const s = CALLOUT_STYLE[kind] ?? CALLOUT_STYLE.note;
  return (
    <aside className={`not-prose my-6 rounded-r-md border-l-4 px-4 py-3 ${s.cls}`} data-callout={kind}>
      <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-current text-[0.7rem] font-bold" aria-hidden="true">
          {s.mark}
        </span>
        <span className="font-display">{title || s.label}</span>
      </p>
      <div className="md text-[0.97rem] leading-relaxed text-ink">{children}</div>
    </aside>
  );
}

export function SvgFigure({ svg, alt, caption }: { svg: string; alt?: string; caption?: string }) {
  return (
    <figure className="svg-figure not-prose my-7" role="group" aria-label={alt || caption || "Схема"}>
      <div className="paper graph-paper p-3 sm:p-4" dangerouslySetInnerHTML={{ __html: svg }} />
      {caption && <figcaption className="mt-2 text-center font-display text-sm italic text-muted">Рис. — {caption}</figcaption>}
    </figure>
  );
}

export function StaticCode({ html, lang }: { html: string; lang?: string }) {
  return (
    <div className="not-prose my-4">
      {lang && lang !== "text" && lang !== "python" && lang !== "py" && <div className="mb-1 text-xs text-muted">{lang}</div>}
      <pre className="code-block" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

export function TableWrap(props: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="table-wrap not-prose my-5">
      <table {...props} />
    </div>
  );
}
