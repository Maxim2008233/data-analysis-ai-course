// Элементы интерфейса в стиле «лабораторного журнала».
import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "warm" | "secondary" | "ghost" | "danger" | "ok";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-[var(--bg-elev)] hover:brightness-110 border border-transparent dark:text-[#0c1422]",
  warm: "bg-warm text-white hover:brightness-110 border border-transparent dark:text-[#0e1a13]",
  secondary: "bg-elev text-ink border border-line-strong hover:border-accent",
  ghost: "bg-transparent text-ink border border-transparent hover:bg-soft",
  danger: "bg-bad text-white border border-transparent hover:brightness-110 dark:text-[#1a0f0e]",
  ok: "bg-ok text-white border border-transparent hover:brightness-110 dark:text-[#0e1a13]",
};

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  const sz = size === "sm" ? "px-2.5 py-1 text-sm" : "px-3.5 py-2 text-[0.95rem]";
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${sz} ${VARIANTS[variant]} ${className}`}
    />
  );
}

export function ButtonLink({ href, variant = "warm", className = "", children }: { href: string; variant?: Variant; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 font-semibold transition ${VARIANTS[variant]} ${className}`}>
      {children}
    </Link>
  );
}

export function Badge({ children, tone = "neutral", className = "" }: { children: ReactNode; tone?: "neutral" | "accent" | "ok" | "warn" | "bad" | "info" | "warm"; className?: string }) {
  const tones: Record<string, string> = {
    neutral: "border-line-strong text-muted",
    accent: "border-accent/50 text-accent-ink",
    warm: "border-warm/60 text-warm-ink",
    ok: "border-ok/60 text-ok",
    warn: "border-warn/60 text-warn",
    bad: "border-bad/60 text-bad",
    info: "border-info/60 text-info",
  };
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-[3px] border border-dashed px-1.5 py-0.5 text-[0.72rem] font-semibold uppercase tracking-wide ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}

/** Полоса прогресса, разбитая на отрезки (по модулям или по урокам). */
export function SegmentBar({ segments, label }: { segments: { done: number; total: number; title?: string }[]; label?: string }) {
  const total = segments.reduce((n, s) => n + s.total, 0) || 1;
  const done = segments.reduce((n, s) => n + s.done, 0);
  return (
    <div className="flex h-3 w-full gap-[2px]" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total} aria-label={label ?? "Прогресс"}>
      {segments.map((s, i) => (
        <div key={i} className="relative h-full overflow-hidden rounded-[2px] bg-soft" style={{ flexGrow: Math.max(s.total, 1), flexBasis: 0 }} title={s.title ? `${s.title}: ${s.done} из ${s.total}` : undefined}>
          <div className="h-full bg-ok" style={{ width: `${s.total ? (s.done / s.total) * 100 : 0}%` }} />
        </div>
      ))}
    </div>
  );
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label?: string }) {
  return <SegmentBar segments={[{ done: value, total: max }]} label={label} />;
}

/** Клетки: одна клетка — один урок или задание. */
export function Cells({ statuses, size = 10 }: { statuses: ("not_started" | "in_progress" | "solved")[]; size?: number }) {
  return (
    <span className="cells" aria-hidden="true">
      {statuses.map((s, i) => (
        <span key={i} className={`cell ${s === "solved" ? "solved" : s === "in_progress" ? "progress" : ""}`} style={{ width: size, height: size }} />
      ))}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`paper ${className}`}>{children}</div>;
}

export function StatusDot({ status }: { status: "not_started" | "in_progress" | "solved" }) {
  if (status === "solved")
    return (
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] bg-ok text-[11px] font-bold text-white dark:text-[#0e1a13]" title="Решено" aria-label="Решено">
        ✓
      </span>
    );
  if (status === "in_progress")
    return (
      <span
        className="inline-block h-5 w-5 shrink-0 rounded-[4px] border-2 border-warm"
        style={{ background: "repeating-linear-gradient(135deg, var(--warm) 0 2px, transparent 2px 5px)" }}
        title="В процессе"
        aria-label="В процессе"
      />
    );
  return <span className="inline-block h-5 w-5 shrink-0 rounded-[4px] border-2 border-line-strong" title="Не начато" aria-label="Не начато" />;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="font-display text-[0.95rem] italic text-warm-ink">{children}</p>;
}

export const DIFFICULTY_LABEL: Record<string, string> = { warmup: "Разминка", main: "Основное", star: "★ Со звёздочкой" };
export const KIND_LABEL: Record<string, string> = {
  code: "Код",
  quiz: "Квиз",
  bug: "Найди ошибку",
  predict: "Предскажи вывод",
  plot: "График",
};
