"use client";
// Редактор кода на CodeMirror 6: подсветка Python, автодополнение, Ctrl/Cmd+Enter — запуск.
// На телефоне и планшете, пока редактор в фокусе, над клавиатурой — панель символов (MobileCodeKeys).
import { useEffect, useRef, useState } from "react";
import { EditorState, Prec, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderExt,
  type DecorationSet,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { python } from "@codemirror/lang-python";
import { bracketMatching, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { classHighlighter } from "@lezer/highlight";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionContext } from "@codemirror/autocomplete";
import { LIBRARY_COMPLETIONS } from "./completions";
import { CODE_KEYS_HEIGHT, MobileCodeKeys, useCoarsePointer } from "./MobileCodeKeys";

const setErrorLine = StateEffect.define<number | null>();
const errorLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setErrorLine)) {
        if (e.value === null || e.value < 1 || e.value > tr.state.doc.lines) return Decoration.none;
        const line = tr.state.doc.line(e.value);
        return Decoration.set([Decoration.line({ class: "cm-error-line" }).range(line.from)]);
      }
    }
    if (tr.docChanged) return Decoration.none;
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function libraryCompletion(ctx: CompletionContext) {
  const word = ctx.matchBefore(/[A-Za-z_][\w]*\.[\w]*$/);
  if (!word) return null;
  const [obj] = word.text.split(".");
  const list = LIBRARY_COMPLETIONS[obj];
  if (!list) return null;
  const dot = word.text.indexOf(".");
  return {
    from: word.from + dot + 1,
    options: list.map((label) => ({ label, type: label.endsWith("()") ? "function" : "property", apply: label.replace(/\(\)$/, "") })),
    validFor: /^\w*$/,
  };
}

interface Props {
  value: string;
  onChange?: (value: string) => void;
  onRun?: () => void;
  readOnly?: boolean;
  errorLine?: number | null;
  ariaLabel: string;
  placeholder?: string;
  maxHeight?: number;
}

export default function CodeEditor({ value, onChange, onRun, readOnly = false, errorLine = null, ariaLabel, placeholder, maxHeight = 520 }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  useEffect(() => {
    onChangeRef.current = onChange;
    onRunRef.current = onRun;
  });
  const coarse = useCoarsePointer();
  const [focused, setFocused] = useState(false);
  // фокус уходит не сразу: если браузер на миг уведёт его при нажатии кнопки панели, панель не исчезнет из-под пальца
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (blurTimer.current) clearTimeout(blurTimer.current);
    },
    []
  );

  useEffect(() => {
    if (!host.current) return;
    const extensions: Extension[] = [
      lineNumbers(),
      history(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      indentUnit.of("    "),
      EditorState.tabSize.of(4),
      python(),
      syntaxHighlighting(classHighlighter),
      autocompletion({ override: undefined }),
      EditorState.languageData.of(() => [{ autocomplete: libraryCompletion }]),
      errorLineField,
      Prec.highest(
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              onRunRef.current?.();
              return true;
            },
          },
          {
            key: "Shift-Enter",
            run: () => {
              onRunRef.current?.();
              return true;
            },
          },
        ])
      ),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
      EditorView.theme({
        "&": { maxHeight: `${maxHeight}px` },
        ".cm-scroller": { overflow: "auto" },
        ".cm-content": { padding: "8px 0", minHeight: "3.2em" },
      }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onChangeRef.current?.(u.state.doc.toString());
        if (u.focusChanged) {
          if (blurTimer.current) clearTimeout(blurTimer.current);
          if (u.view.hasFocus) setFocused(true);
          else blurTimer.current = setTimeout(() => setFocused(false), 200);
        }
      }),
      // на сенсорном экране курсор не должен прятаться под панелью символов
      EditorView.scrollMargins.of(() => (window.matchMedia?.("(pointer: coarse)").matches ? { bottom: CODE_KEYS_HEIGHT + 8 } : null)),
    ];
    if (readOnly) {
      extensions.push(EditorState.readOnly.of(true), EditorView.editable.of(false), EditorView.editorAttributes.of({ class: "cm-readonly-editor" }));
    } else {
      extensions.push(highlightActiveLine(), highlightActiveLineGutter());
    }
    if (placeholder) extensions.push(placeholderExt(placeholder));
    const v = new EditorView({ state: EditorState.create({ doc: value, extensions }), parent: host.current });
    view.current = v;
    // доступ к редактору для автотестов (Playwright) — не влияет на работу сайта
    (host.current as HTMLDivElement & { __cmView?: EditorView }).__cmView = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // редактор создаётся один раз; внешнее значение синхронизируется ниже
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);

  // внешнее изменение значения (сброс к исходному, вставка решения)
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const cur = v.state.doc.toString();
    if (cur !== value) v.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: setErrorLine.of(errorLine) });
  }, [errorLine]);

  return (
    <>
      <div ref={host} className="overflow-hidden" data-testid="code-editor" />
      {coarse && focused && !readOnly && <MobileCodeKeys getView={() => view.current} />}
    </>
  );
}
