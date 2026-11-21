// Подсветка Python тем же парсером, что и в редакторе CodeMirror (одинаковые цвета на сервере и в браузере).
import { parser } from "@lezer/python";
import { classHighlighter, highlightCode } from "@lezer/highlight";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function highlightPython(code: string): string {
  let html = "";
  try {
    highlightCode(
      code,
      parser.parse(code),
      classHighlighter,
      (text, classes) => {
        const esc = escapeHtml(text);
        html += classes ? `<span class="${classes}">${esc}</span>` : esc;
      },
      () => {
        html += "\n";
      }
    );
  } catch {
    html = escapeHtml(code);
  }
  return html;
}
