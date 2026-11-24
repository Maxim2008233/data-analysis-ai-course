// Tab в редакторе кода — как в IDE: отступ в месте курсора до следующей позиции табуляции,
// выделение внутри строки заменяется отступом, выделение на целые строки сдвигает строки.
import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { indentUnit } from "@codemirror/language";
import { insertIndentAtCursor } from "@/components/code/editorKeys";

function tab(doc: string, anchor: number, head = anchor, opts: { readOnly?: boolean } = {}) {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.single(anchor, head),
    extensions: [indentUnit.of("    "), EditorState.tabSize.of(4), EditorState.readOnly.of(Boolean(opts.readOnly))],
  });
  const handled = insertIndentAtCursor({ state, dispatch: (tr) => (state = tr.state) });
  return { handled, doc: state.doc.toString(), from: state.selection.main.from, to: state.selection.main.to };
}

describe("Tab как в IDE", () => {
  it("в начале строки — 4 пробела, код сдвигается вправо", () => {
    expect(tab("print(x)", 0)).toEqual({ handled: true, doc: "    print(x)", from: 4, to: 4 });
  });

  it("в середине строки — пробелы до следующей позиции табуляции, а не сдвиг всей строки", () => {
    expect(tab("x = 1", 1)).toMatchObject({ doc: "x    = 1", from: 4 }); // колонка 1 → 3 пробела
    expect(tab("abcd", 4)).toMatchObject({ doc: "abcd    ", from: 8 }); // ровно на позиции табуляции → 4 пробела
    expect(tab("for x in xs:\n  y", 15)).toMatchObject({ doc: "for x in xs:\n    y", from: 17 }); // колонка 2 → 2 пробела
  });

  it("выделение внутри строки заменяется отступом", () => {
    expect(tab("x = 1", 2, 3)).toMatchObject({ doc: "x    1", from: 4 }); // «=» → до колонки 4
  });

  it("выделенная целиком строка и несколько строк — сдвигаются вправо", () => {
    expect(tab("print(x)", 0, 8).doc).toBe("    print(x)");
    expect(tab("a = 1\nb = 2", 2, 9).doc).toBe("    a = 1\n    b = 2");
  });

  it("в редакторе только для чтения ничего не делает", () => {
    expect(tab("x", 0, 0, { readOnly: true })).toMatchObject({ handled: false, doc: "x" });
  });
});
