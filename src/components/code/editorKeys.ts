// Клавиши редактора кода — как в IDE (VS Code, PyCharm):
//   Tab        — если открыт список подсказок, подставить выбранную; иначе отступ в месте курсора: код справа
//                сдвигается до следующей позиции табуляции (4 пробела). Выделение внутри строки заменяется отступом,
//                выделение на целую строку или на несколько строк — эти строки сдвигаются вправо;
//   Shift+Tab  — убрать отступ у строки (или у выделенных строк);
//   Enter      — всегда новая строка: подсказку не подставляет, список подсказок закрывается;
//   ↑/↓, PageUp/PageDown — выбор в списке подсказок; Esc — закрыть список; Ctrl+Space — открыть.
// Тот же Tab выполняет кнопка «⇥» на панели символов для телефона (MobileCodeKeys).
import { acceptCompletion, closeCompletion, completionStatus, moveCompletionSelection, startCompletion } from "@codemirror/autocomplete";
import { indentLess, indentMore } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { EditorSelection, countColumn, type EditorState, type SelectionRange, type StateCommand } from "@codemirror/state";
import type { Command, KeyBinding } from "@codemirror/view";

/** Выделение, при котором Tab сдвигает строки целиком: на несколько строк или на всю строку от начала до конца. */
function shiftsLines(state: EditorState, r: SelectionRange): boolean {
  if (r.empty) return false;
  const from = state.doc.lineAt(r.from);
  const to = state.doc.lineAt(r.to);
  if (from.number !== to.number) return true;
  return r.from === from.from && r.to === from.to;
}

/**
 * Отступ как в IDE: в месте курсора — пробелы до следующей позиции табуляции (код справа сдвигается);
 * выделение внутри строки заменяется таким отступом; выделение на строки целиком — строки сдвигаются (indentMore).
 */
export const insertIndentAtCursor: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  if (state.selection.ranges.some((r) => shiftsLines(state, r))) return indentMore({ state, dispatch });
  const unit = state.facet(indentUnit);
  const width = unit === "\t" ? state.tabSize : unit.length;
  const spec = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.from);
    const col = countColumn(line.text.slice(0, range.from - line.from), state.tabSize);
    const insert = unit === "\t" ? "\t" : " ".repeat(width - (col % width));
    return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(range.from + insert.length) };
  });
  dispatch(state.update(spec, { scrollIntoView: true, userEvent: "input.indent" }));
  return true;
};

/** Tab: подставить подсказку, если список открыт, иначе — отступ в месте курсора. */
export const codeTab: Command = (view) => acceptCompletion(view) || insertIndentAtCursor(view);

/** Enter при открытом списке подсказок: закрыть список и дальше — обычный перенос строки (следующая привязка). */
const enterClosesCompletion: Command = (view) => {
  if (completionStatus(view.state) !== null) closeCompletion(view);
  return false;
};

/**
 * Привязки клавиш: подключаются с повышенным приоритетом, а автодополнение — без своих стандартных клавиш
 * (autocompletion({ defaultKeymap: false })): там Enter подставляет подсказку, а Tab не делает ничего.
 */
export const ideKeymap: readonly KeyBinding[] = [
  { key: "Tab", run: codeTab, shift: indentLess },
  { key: "Enter", run: enterClosesCompletion },
  { key: "Ctrl-Space", run: startCompletion },
  { mac: "Alt-`", run: startCompletion },
  { key: "Escape", run: closeCompletion },
  { key: "ArrowDown", run: moveCompletionSelection(true) },
  { key: "ArrowUp", run: moveCompletionSelection(false) },
  { key: "PageDown", run: moveCompletionSelection(true, "page") },
  { key: "PageUp", run: moveCompletionSelection(false, "page") },
];
