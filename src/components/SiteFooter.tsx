import Link from "next/link";
import { PYODIDE_VERSION, REPORT_BUG_URL } from "@/lib/config";

export function SiteFooter() {
  return (
    <footer className="no-print mt-20 border-t border-dashed border-line-strong">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-6 text-sm text-muted sm:px-8 md:flex-row md:items-center">
        <p className="font-display italic">
          Python выполняется прямо в вашем браузере — Pyodide {PYODIDE_VERSION}. Ничего устанавливать не нужно.
        </p>
        <div className="flex flex-wrap gap-4 md:ml-auto">
          <Link href="/about" className="hover:text-ink">
            Как устроен сайт
          </Link>
          <a href={REPORT_BUG_URL} target="_blank" rel="noreferrer" className="hover:text-ink" data-testid="report-bug-footer">
            Нашли ошибку?
          </a>
        </div>
      </div>
    </footer>
  );
}
