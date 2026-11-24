"use client";
// Панель символов для телефона и планшета: скобки, двоеточие, кавычки, отступ и другие знаки Python, которых нет
// на первом экране экранной клавиатуры. Видна, пока редактор кода в фокусе, и стоит прямо над клавиатурой:
// её место считается по window.visualViewport (видимая часть страницы без клавиатуры) — так и на iPhone, и на Android.
// Кнопки не забирают фокус у редактора (preventDefault на pointerdown/mousedown), иначе клавиатура закрылась бы.
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { insertBracket } from "@codemirror/autocomplete";
import { cursorCharLeft, cursorCharRight, cursorLineDown, cursorLineUp, indentLess, redo, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { codeTab } from "./editorKeys";

interface CodeKey {
  label: string;
  /** Название для экранного диктора, если знак сам по себе непонятен. */
  aria?: string;
  run: (v: EditorView) => void;
}

/** Набрать текст так же, как с клавиатуры: скобки и кавычки — парой, курсор между ними (closeBrackets). */
export function typeText(v: EditorView, text: string) {
  const bracket = text.length === 1 ? insertBracket(v.state, text) : null;
  v.dispatch(bracket ?? v.state.update(v.state.replaceSelection(text), { scrollIntoView: true, userEvent: "input.type" }));
}

const char = (ch: string, aria?: string): CodeKey => ({ label: ch, aria, run: (v) => typeText(v, ch) });

/** Порядок — по частоте в коде курса: отступ, скобки, двоеточие, присваивание, кавычки, точка… */
export const CODE_KEYS: CodeKey[] = [
  // как клавиша Tab в редакторе: подставить подсказку, если список открыт, иначе отступ в месте курсора
  { label: "⇥", aria: "Отступ или подставить подсказку", run: (v) => void codeTab(v) },
  char("("),
  char(")"),
  char("["),
  char("]"),
  char(":", "Двоеточие"),
  char("=", "Равно"),
  char('"', "Двойная кавычка"),
  char("'", "Одинарная кавычка"),
  char(".", "Точка"),
  char(",", "Запятая"),
  char("_", "Подчёркивание"),
  char("#", "Решётка: комментарий"),
  char("{"),
  char("}"),
  char("+"),
  char("-", "Минус"),
  char("*"),
  char("/"),
  char("<"),
  char(">"),
  char("!"),
  char("%"),
  { label: "←", aria: "Курсор влево", run: (v) => void cursorCharLeft(v) },
  { label: "→", aria: "Курсор вправо", run: (v) => void cursorCharRight(v) },
  { label: "↑", aria: "Строка выше", run: (v) => void cursorLineUp(v) },
  { label: "↓", aria: "Строка ниже", run: (v) => void cursorLineDown(v) },
  { label: "↶", aria: "Отменить", run: (v) => void undo(v) },
  { label: "↷", aria: "Повторить", run: (v) => void redo(v) },
  { label: "⇤", aria: "Убрать отступ", run: (v) => void indentLess(v) },
];

// --- телефон или планшет: основной указатель — палец ---
function subscribeCoarse(cb: () => void) {
  const mq = window.matchMedia?.("(pointer: coarse)");
  mq?.addEventListener?.("change", cb);
  return () => mq?.removeEventListener?.("change", cb);
}
const coarseNow = () => window.matchMedia?.("(pointer: coarse)").matches === true;

export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribeCoarse, coarseNow, () => false);
}

// --- видимая часть страницы: над экранной клавиатурой ---
interface ViewportBox {
  bottom: number;
  left: number;
  width: number;
  keyboard: boolean;
}
let box: ViewportBox = { bottom: 0, left: 0, width: 0, keyboard: false };

function readViewport(): ViewportBox {
  const vv = window.visualViewport;
  const bottom = Math.round(vv ? vv.offsetTop + vv.height : window.innerHeight);
  const left = Math.round(vv ? vv.offsetLeft : 0);
  const width = Math.round(vv ? vv.width : window.innerWidth);
  // клавиатура открыта, если видимая часть заметно ниже окна
  const keyboard = vv ? window.innerHeight - vv.height > 120 : false;
  if (bottom !== box.bottom || left !== box.left || width !== box.width || keyboard !== box.keyboard) box = { bottom, left, width, keyboard };
  return box;
}

function subscribeViewport(cb: () => void) {
  const vv = window.visualViewport;
  vv?.addEventListener("resize", cb);
  vv?.addEventListener("scroll", cb);
  window.addEventListener("resize", cb);
  return () => {
    vv?.removeEventListener("resize", cb);
    vv?.removeEventListener("scroll", cb);
    window.removeEventListener("resize", cb);
  };
}

const SERVER_BOX: ViewportBox = { bottom: 0, left: 0, width: 0, keyboard: false };

/** Высота панели — её столько отступает прокрутка редактора снизу, чтобы курсор не прятался под ней. */
export const CODE_KEYS_HEIGHT = 56;

export function MobileCodeKeys({ getView }: { getView: () => EditorView | null }) {
  const vp = useSyncExternalStore(subscribeViewport, readViewport, () => SERVER_BOX);
  const press = (key: CodeKey) => {
    const v = getView();
    if (!v) return;
    key.run(v);
    v.focus(); // если браузер всё же увёл фокус, вернуть его в редактор (клавиатура остаётся открытой)
  };
  // в body: position: fixed не должен зависеть от transform или filter у карточки задания
  return createPortal(
    <div
      role="toolbar"
      aria-label="Символы для кода"
      data-testid="code-keys"
      className="no-print fixed z-50 border-t border-line-strong bg-elev/95 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur"
      style={{
        top: vp.bottom,
        left: vp.left,
        width: vp.width || "100%",
        transform: "translateY(-100%)",
        // без клавиатуры панель у нижнего края экрана: не заходить под полоску «домой» на iPhone
        paddingBottom: vp.keyboard ? 0 : "env(safe-area-inset-bottom)",
      }}
    >
      <div className="flex gap-1.5 overflow-x-auto px-2 py-1.5 [scrollbar-width:none] [touch-action:pan-x]">
        {CODE_KEYS.map((k) => (
          <button
            key={k.label}
            type="button"
            tabIndex={-1}
            aria-label={k.aria ?? k.label}
            title={k.aria}
            // не забирать фокус у редактора: иначе экранная клавиатура закроется
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => press(k)}
            className="h-10 min-w-10 shrink-0 rounded-md border border-line bg-bg px-2.5 font-code text-[1.05rem] leading-none text-ink active:bg-accent-soft"
            data-key={k.label}
          >
            {k.label}
          </button>
        ))}
      </div>
    </div>,
    document.body
  );
}
