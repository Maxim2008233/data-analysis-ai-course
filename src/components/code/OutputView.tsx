"use client";
// Показ результатов выполнения: текст, таблицы (HTML), графики matplotlib, plotly, ошибки.
import { useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import type { OutputItem, PyErrorInfo } from "@/lib/py/client";
// Версия plotly.js совпадает с той, что встроена в plotly 7.1.0 для Python (public/workers/py-engine.mjs).
import { PLOTLY_SRC } from "@/lib/config";

let plotlyPromise: Promise<unknown> | null = null;
// типы графиков plotly без декартовых осей x/y
const NON_CARTESIAN = new Set(["pie", "treemap", "sunburst", "icicle", "indicator", "table", "sankey", "funnelarea", "scatterpolar", "barpolar", "choropleth", "scattergeo"]);

function loadPlotly(): Promise<unknown> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  const w = window as unknown as { Plotly?: unknown };
  if (w.Plotly) return Promise.resolve(w.Plotly);
  if (!plotlyPromise) {
    plotlyPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = PLOTLY_SRC;
      // запрос с CORS: такой ответ service worker может сохранить для офлайн-режима (public/sw.js)
      s.crossOrigin = "anonymous";
      s.async = true;
      s.onload = () => resolve((window as unknown as { Plotly: unknown }).Plotly);
      s.onerror = () => {
        plotlyPromise = null;
        reject(new Error("Не удалось загрузить Plotly"));
      };
      document.head.appendChild(s);
    });
  }
  return plotlyPromise;
}

function PlotlyFigure({ json }: { json: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadPlotly()
      .then((P) => {
        if (cancelled || !ref.current) return;
        const fig = JSON.parse(json) as { data: unknown[]; layout: Record<string, unknown> };
        const dark = document.documentElement.classList.contains("dark");
        const layout: Record<string, unknown> = {
          ...fig.layout,
          autosize: true,
          paper_bgcolor: dark ? "#1a1b1e" : "#ffffff",
          font: { ...(fig.layout.font as object), color: dark ? "#e8e8e6" : "#1c1c1a" },
        };
        if (dark) {
          // светлый фон области графика из шаблона plotly в тёмной теме слепит: делаем его тёмным, сетку — приглушённой
          layout.plot_bgcolor = "#202226";
          const axisKeys = Object.keys(layout).filter((k) => /^[xy]axis\d*$/.test(k));
          const cartesian = (fig.data as { type?: string }[]).some((t) => !NON_CARTESIAN.has(t.type ?? "scatter"));
          for (const k of new Set([...axisKeys, ...(cartesian ? ["xaxis", "yaxis"] : [])])) {
            layout[k] = { ...(layout[k] as object), gridcolor: "#3a3d42", zerolinecolor: "#4a4d52", linecolor: "#4a4d52" };
          }
        }
        // responsive-режим растягивает рисунок на 100 % высоты контейнера: задаём её явно (высота из макета или 450 px)
        const height = typeof fig.layout.height === "number" ? fig.layout.height : 450;
        ref.current.style.height = `${height}px`;
        (P as { newPlot: (el: HTMLElement, d: unknown, l: unknown, c: unknown) => void }).newPlot(ref.current, fig.data, layout, {
          responsive: true,
          displaylogo: false,
        });
      })
      .catch((e) => setErr(String(e?.message || e)));
    return () => {
      cancelled = true;
    };
  }, [json]);
  if (err) return <p className="text-sm text-warn">Интерактивный график не загрузился: {err}</p>;
  return <div ref={ref} className="min-h-[360px] w-full" data-testid="plotly-figure" />;
}

function SafeHtml({ html }: { html: string }) {
  const clean = DOMPurify.sanitize(html, { ADD_TAGS: ["style"], FORCE_BODY: true });
  return <div className="py-html" dangerouslySetInnerHTML={{ __html: clean }} />;
}

/** Текст сообщения, где фрагменты в `обратных кавычках` показываются как код. */
export function CodeText({ text }: { text: string }) {
  const parts = text.split(/`([^`]+)`/g);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <code key={i} className="rounded bg-elev/70 px-1 py-px font-mono text-[0.92em]">
            {p}
          </code>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

export function ErrorBox({ error, lineOffsetNote }: { error: PyErrorInfo; lineOffsetNote?: string }) {
  const [showTb, setShowTb] = useState(false);
  return (
    <div className="rounded-lg border border-bad/40 bg-bad-soft p-3 text-sm" role="alert" data-testid="error-box">
      <p className="font-semibold text-bad">
        <CodeText text={error.title} />
        {error.line && error.where === "<ваш код>" ? <span className="font-normal"> — строка {error.line}</span> : null}
        {error.where === "<подготовка>" ? <span className="font-normal"> — в подготовке</span> : null}
      </p>
      {error.hint && (
        <p className="mt-1 text-ink">
          <CodeText text={error.hint} />
        </p>
      )}
      <p className="mt-2 break-words font-mono text-xs text-muted">
        {error.type}: {error.message}
      </p>
      {lineOffsetNote && <p className="mt-1 text-xs text-muted">{lineOffsetNote}</p>}
      {error.traceback && (
        <div className="mt-2">
          <button type="button" className="text-xs text-accent-ink underline" onClick={() => setShowTb((v) => !v)} aria-expanded={showTb}>
            {showTb ? "Скрыть traceback" : "Показать полный traceback"}
          </button>
          {showTb && <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-elev p-2 font-mono text-xs text-ink">{error.traceback}</pre>}
        </div>
      )}
    </div>
  );
}

export function OutputView({ outputs, error }: { outputs: OutputItem[]; error?: PyErrorInfo | null }) {
  if (!outputs.length && !error) return null;
  return (
    <div className="py-output space-y-2" data-testid="output">
      {outputs.map((o, i) => {
        if (o.type === "text")
          return (
            <pre key={i} className={o.stream === "stderr" ? "text-warn" : "text-ink"} data-testid={o.stream === "stderr" ? "stderr" : "stdout"}>
              {o.text}
            </pre>
          );
        if (o.type === "html") return <SafeHtml key={i} html={o.html ?? ""} />;
        if (o.type === "image")
          // eslint-disable-next-line @next/next/no-img-element
          return <img key={i} src={`data:image/png;base64,${o.data}`} alt="График, построенный кодом" className="py-plot max-w-full" data-testid="plot-image" />;
        if (o.type === "plotly") return <PlotlyFigure key={i} json={o.json ?? "{}"} />;
        if (o.type === "markdown") return <pre key={i}>{o.text}</pre>;
        return null;
      })}
      {error && <ErrorBox error={error} />}
    </div>
  );
}
