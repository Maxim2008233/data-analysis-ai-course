# -*- coding: utf-8 -*-
"""
Исполнитель кода учебного сайта.

Работает одинаково в браузере (Pyodide в Web Worker) и в Node (скрипт проверки контента).
Две операции:
  * run   — выполнить пример/код ученика в общем пространстве имён урока,
            показать вывод как в Jupyter (print, последнее выражение, таблицы, графики);
  * check — выполнить подготовку + код ученика в чистом пространстве имён и запустить тесты задания.

Тесты задания — обычный Python-код, которому доступны помощники (var, ref, close, same_frame, ...).
Проверка сообщает по-русски, что именно не так; ошибки Python переводятся на понятный язык.
"""
import ast
import base64
import builtins
import contextlib
import difflib
import io
import json
import linecache
import math
import os
import random
import re
import sys
import traceback
import types
import warnings

STUDENT_FILE = "<ваш код>"
PRELUDE_FILE = "<подготовка>"
SOLUTION_FILE = "<эталон>"
TEST_FILE = "<проверка>"
SETUP_FILE = "<подготовка урока>"

WORK_DIR = "/home/pyodide/work"
DATA_DIR = "/home/pyodide/data"      # исходные копии датасетов (код ученика их не меняет)
VARIANT_ROOT = "/home/pyodide/variants"
STRICT_WARNINGS = False               # True в скрипте проверки контента: показываем и DeprecationWarning

MAX_TEXT = 20000
MAX_IMAGES = 12
MAX_HTML = 400_000
MAX_PLOTLY = 8
MAX_PLOTLY_JSON = 8_000_000

os.environ.setdefault("MPLBACKEND", "Agg")


# ---------------------------------------------------------------------------
# Сбор вывода
# ---------------------------------------------------------------------------
class Output:
    """Упорядоченный список элементов вывода (текст, html, картинки, plotly)."""

    def __init__(self, enabled=True):
        self.items = []
        self.enabled = enabled
        self.text_len = 0
        self.images = 0
        self.truncated = False
        self.plotly_truncated = False

    def text(self, s, stream="stdout"):
        if not self.enabled or not s:
            return
        if self.text_len >= MAX_TEXT:
            if not self.truncated:
                self.truncated = True
                self.items.append({"type": "text", "stream": "stderr",
                                   "text": "\n…вывод обрезан (слишком много строк)…\n"})
            return
        room = MAX_TEXT - self.text_len
        s = s[:room]
        self.text_len += len(s)
        if self.items and self.items[-1]["type"] == "text" and self.items[-1]["stream"] == stream:
            self.items[-1]["text"] += s
        else:
            self.items.append({"type": "text", "stream": stream, "text": s})

    def html(self, h):
        if not self.enabled:
            return
        if len(h) > MAX_HTML:
            self.text("[таблица слишком большая для показа; выведите часть строк, например .head()]\n", "stderr")
            return
        self.items.append({"type": "html", "html": h})

    def image(self, b64):
        if not self.enabled:
            return
        if self.images >= MAX_IMAGES:
            if self.images == MAX_IMAGES:
                self.text("[показаны первые %d графиков]\n" % MAX_IMAGES, "stderr")
            self.images += 1
            return
        self.images += 1
        self.items.append({"type": "image", "data": b64})

    def plotly(self, fig_json):
        if not self.enabled:
            return
        if len(fig_json) > MAX_PLOTLY_JSON:
            self.text("[интерактивный график слишком большой (%.0f МБ) — постройте его по части строк, "
                      "например df.sample(5000, random_state=0)]\n" % (len(fig_json) / 1e6), "stderr")
            return
        n = sum(1 for i in self.items if i["type"] == "plotly")
        if n >= MAX_PLOTLY:
            if not self.plotly_truncated:
                self.plotly_truncated = True
                self.text("[показаны первые %d интерактивных графиков]\n" % MAX_PLOTLY, "stderr")
            return
        self.items.append({"type": "plotly", "json": fig_json})


class _Stream(io.TextIOBase):
    def __init__(self, out, name):
        self.out = out
        self.name = name

    def write(self, s):
        self.out.text(s, self.name)
        return len(s)

    def flush(self):
        pass

    def isatty(self):
        return False


_current_out = Output(enabled=False)
_captured_figures = []  # фигуры текущего запуска (для тестов графиков)
_captured_plotly = []  # фигуры plotly, показанные в текущем запуске (для тестов)


# Понятные объяснения частых предупреждений: (имя категории или None, фрагмент текста или None, объяснение)
_WARNING_RU = [
    ("ChainedAssignmentError", None,
     "присваивание по цепочке вида df[маска]['колонка'] = … не меняет исходную таблицу "
     "(в pandas 3 действует Copy-on-Write). Запишите одной операцией: df.loc[маска, 'колонка'] = значение."),
    ("SettingWithCopyWarning", None,
     "значение записывается в копию части таблицы. Запишите одной операцией: df.loc[маска, 'колонка'] = значение, "
     "а для отдельной таблицы сделайте .copy()."),
    (None, "Mean of empty slice",
     "среднее по пустому набору значений, результат — nan. Проверьте условие отбора: возможно, не подошла ни одна строка."),
    (None, "divide by zero",
     "деление на ноль — в результате появились бесконечности (inf)."),
    (None, "invalid value encountered",
     "недопустимая операция (например, 0/0 или корень из отрицательного числа) — в результате появились nan."),
    (None, "No artists with labels found to put in legend",
     "легенда пустая: ни у одного слоя графика нет подписи. Добавьте её слою: `ax.plot(..., label='Средняя цена')`."),
    (None, "Glyph",
     "в шрифте графика нет какого-то символа (например, эмодзи) — он показан пустым квадратом."),
]


def _short_warning(message, category, filename, lineno, file=None, line=None):
    name = category.__name__
    text = str(message).strip().split("\n")[0]
    if len(text) > 300:
        text = text[:300] + "…"
    for cat, frag, ru in _WARNING_RU:
        if (cat is None or cat == name) and (frag is None or frag in text):
            _current_out.text("Предупреждение (%s): %s\n" % (name, ru), "stderr")
            return
    _current_out.text("Предупреждение (%s): %s\n" % (name, text), "stderr")


# ---------------------------------------------------------------------------
# Отображение значений (как в Jupyter)
# ---------------------------------------------------------------------------
def _flush_figures(out=None, close=True):
    out = out or _current_out
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is None:
        return
    for num in list(plt.get_fignums()):
        fig = plt.figure(num)
        if fig not in _captured_figures:
            _captured_figures.append(fig)
        try:
            buf = io.BytesIO()
            fig.savefig(buf, format="png", dpi=96, bbox_inches="tight")
            out.image(base64.b64encode(buf.getvalue()).decode("ascii"))
        except Exception as e:  # pragma: no cover
            out.text("[не удалось нарисовать график: %s]\n" % e, "stderr")
        if close:
            plt.close(fig)


def _show_plotly(fig, out):
    """Показать фигуру plotly (интерактивно на странице) и запомнить её для тестов."""
    if fig not in _captured_plotly:
        _captured_plotly.append(fig)
    try:
        out.plotly(fig.to_json())
    except Exception as e:  # pragma: no cover
        out.text("[не удалось показать интерактивный график: %s]\n" % e, "stderr")


def display(*values, **kwargs):
    for value in values:
        _display_value(value, _current_out)


def _display_value(value, out):
    if value is None:
        return
    mod = type(value).__module__ or ""
    cls = type(value).__name__
    # pandas Styler
    if cls == "Styler" and hasattr(value, "to_html"):
        try:
            out.html(value.to_html())
            return
        except Exception as e:
            out.text("[Styler не удалось показать: %s]\n" % e, "stderr")
            return
    # plotly
    if mod.startswith("plotly") and hasattr(value, "to_json"):
        _show_plotly(value, out)
        return
    # matplotlib объекты: выводим текущие фигуры
    if mod.startswith("matplotlib"):
        if cls in ("Figure",):
            _flush_figures(out)
            return
        # Axes, списки линий, контейнеры — сами фигуры покажем в конце
        return
    if isinstance(value, (list, tuple)) and value and all(
        (type(v).__module__ or "").startswith("matplotlib") for v in value
    ):
        return
    # наш HTML/Markdown
    if isinstance(value, (HTML, Markdown)):
        if isinstance(value, HTML):
            out.html(value.data)
        else:
            out.items.append({"type": "markdown", "text": value.data})
        return
    # pandas DataFrame / Series
    if cls == "DataFrame" and hasattr(value, "_repr_html_"):
        try:
            h = value._repr_html_()
            if h:
                out.html(h)
                return
        except Exception:
            pass
    out.text(_safe_repr(value) + "\n")


def _safe_repr(value):
    try:
        r = repr(value)
    except Exception as e:  # pragma: no cover
        r = "<не удалось показать значение: %s>" % e
    if len(r) > 10000:
        r = r[:10000] + "…"
    return r


class HTML:
    def __init__(self, data):
        self.data = str(data)


class Markdown:
    def __init__(self, data):
        self.data = str(data)


def _install_ipython_shim():
    """Модуль IPython.display, чтобы код из ноутбуков работал без изменений."""
    if "IPython" in sys.modules:
        return
    ip = types.ModuleType("IPython")
    disp = types.ModuleType("IPython.display")
    disp.display = display
    disp.HTML = HTML
    disp.Markdown = Markdown
    disp.clear_output = lambda *a, **k: None
    ip.display = disp
    # matplotlib/plotly/tqdm проверяют наличие IPython: сообщаем, что это не интерактивная оболочка
    ip.get_ipython = lambda: None
    ip.version_info = (8, 30, 0, "")
    ip.__version__ = "8.30.0"
    sys.modules["IPython"] = ip
    sys.modules["IPython.display"] = disp


def _patch_libraries():
    """Настройки библиотек, если они уже импортированы."""
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is not None and not getattr(plt, "_course_patched", False):
        def _show(*args, **kwargs):
            _flush_figures(_current_out, close=True)
        plt.show = _show
        plt._course_patched = True
    pd = sys.modules.get("pandas")
    if pd is not None and not getattr(pd, "_course_patched", False):
        try:
            pd.set_option("display.max_rows", 30)
            pd.set_option("display.min_rows", 10)
            pd.set_option("display.max_columns", 30)
            pd.set_option("display.width", 120)
        except Exception:
            pass
        pd._course_patched = True
    bdt = sys.modules.get("plotly.basedatatypes")
    if bdt is not None and not getattr(bdt, "_course_patched", False):
        def _pshow(self, *a, **k):
            _show_plotly(self, _current_out)
        bdt.BaseFigure.show = _pshow
        bdt._course_patched = True
    pio = sys.modules.get("plotly.io")
    if pio is not None and not getattr(pio, "_course_patched", False):
        def _pio_show(fig, *a, **k):
            _show_plotly(fig, _current_out)
        pio.show = _pio_show
        pio._course_patched = True
    np = sys.modules.get("numpy")
    if np is not None and not getattr(np, "_course_patched", False):
        np._course_patched = True


def _prepare_imports(code):
    """Импортируем библиотеки, которые встречаются в коде, заранее — чтобы применить настройки."""
    if re.search(r"\bmatplotlib\b|\bseaborn\b|\bplt\b", code):
        try:
            import matplotlib  # noqa
            matplotlib.use("Agg")
            import matplotlib.pyplot  # noqa
        except Exception:
            pass
    if re.search(r"\bpandas\b|\bpd\.", code):
        try:
            import pandas  # noqa
        except Exception:
            pass
    if re.search(r"\bplotly\b", code):
        try:
            import plotly.basedatatypes  # noqa
        except Exception:
            pass
    _patch_libraries()


# ---------------------------------------------------------------------------
# Выполнение ячейки
# ---------------------------------------------------------------------------
def _register_source(filename, code):
    linecache.cache[filename] = (len(code), None, code.splitlines(True), filename)


def exec_cell(code, ns, filename, show_last=True):
    """Выполнить код. Если последняя инструкция — выражение, показать его значение."""
    _register_source(filename, code)
    tree = ast.parse(code, filename=filename, mode="exec")
    last = None
    if show_last and tree.body and isinstance(tree.body[-1], ast.Expr):
        last = tree.body.pop()
    exec(compile(tree, filename, "exec"), ns)
    if last is not None:
        expr = ast.Expression(last.value)
        ast.copy_location(expr, last)
        value = eval(compile(expr, filename, "eval"), ns)
        if value is not None:
            _display_value(value, _current_out)


@contextlib.contextmanager
def _capture(out):
    global _current_out
    prev = _current_out
    _current_out = out
    old_out, old_err = sys.stdout, sys.stderr
    sys.stdout = _Stream(out, "stdout")
    sys.stderr = _Stream(out, "stderr")
    old_show = warnings.showwarning
    warnings.showwarning = _short_warning
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("default")
            if not STRICT_WARNINGS:
                warnings.filterwarnings("ignore", category=DeprecationWarning)
            warnings.filterwarnings("ignore", message=".*non-interactive.*")
            # внутреннее предупреждение matplotlib в Pyodide, не связано с кодом ученика
            warnings.filterwarnings("ignore", message="The (x|y|width|height) parameter as float was deprecated")
            warnings.filterwarnings("ignore", message=".*Matplotlib is building the font cache.*")
            # seaborn 0.13 вызывает boxplot/violinplot matplotlib 3.10 со старым параметром vert — это внутри библиотеки
            warnings.filterwarnings("ignore", message="vert: bool will be deprecated", category=PendingDeprecationWarning)
            # threadpoolctl 3.6 (его вызывает scikit-learn, например в kNN) обращается к устаревшему API Pyodide
            warnings.filterwarnings("ignore", message=r"JsProxy\.as_object_map\(\) is deprecated")
            warnings.showwarning = _short_warning
            yield out
    finally:
        warnings.showwarning = old_show
        sys.stdout, sys.stderr = old_out, old_err
        _current_out = prev


@contextlib.contextmanager
def _cwd(path):
    old = os.getcwd()
    os.makedirs(path, exist_ok=True)
    os.chdir(path)
    try:
        yield
    finally:
        os.chdir(old)


def new_namespace():
    ns = {"__name__": "__main__", "__builtins__": builtins, "display": display}
    return ns


def _stage_files(files, target=WORK_DIR):
    """Скопировать исходные датасеты в рабочую папку (восстанавливает их, если код ученика их перезаписал)."""
    os.makedirs(target, exist_ok=True)
    for f in files or []:
        src = os.path.join(DATA_DIR, f)
        dst = os.path.join(target, f)
        if not os.path.exists(src):
            continue
        with open(src, "rb") as fs, open(dst, "wb") as fd:
            fd.write(fs.read())


# ---------------------------------------------------------------------------
# Перевод ошибок на понятный язык
# ---------------------------------------------------------------------------
_KNOWN_MODULES = "numpy, pandas, matplotlib, seaborn, scikit-learn (sklearn), scipy, plotly, lightgbm, statsmodels, transformers (учебная версия)"


def _dataframe_columns(ns):
    cols = []
    for v in list(ns.values()) if ns else []:
        if type(v).__name__ == "DataFrame":
            try:
                cols.extend(str(c) for c in v.columns)
            except Exception:
                pass
    return list(dict.fromkeys(cols))


def _student_frames(tb):
    """Кадры из кода ученика, подготовки и setup. Если ошибка случилась внутри функции из подготовки,
    которую вызвал код ученика, последним идёт кадр ученика: исправлять нужно строку вызова."""
    frames = [f for f in traceback.extract_tb(tb) if f.filename in (STUDENT_FILE, PRELUDE_FILE, SETUP_FILE)]
    own = [i for i, f in enumerate(frames) if f.filename == STUDENT_FILE]
    if own and own[-1] != len(frames) - 1:
        frames = frames[:own[-1] + 1]
    return frames


def _ellipsis_lines(filename):
    """Номера строк кода, где стоит многоточие `...` (заполнитель заготовки), вне строк-литералов."""
    src = "".join(linecache.getlines(filename))
    if "..." not in src:
        return []
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return []
    return sorted({n.lineno for n in ast.walk(tree) if isinstance(n, ast.Constant) and n.value is Ellipsis})


def _clean_traceback(exc):
    lines = traceback.format_exception(type(exc), exc, exc.__traceback__)
    keep = []
    skip = False
    for ln in lines:
        if "runner.py" in ln or "_pyodide" in ln or "<exec>" in ln:
            skip = True
            continue
        if skip and ln.startswith("    ") and not ln.startswith("  File"):
            skip = False
            continue
        skip = False
        keep.append(ln)
    return "".join(keep)


def explain_error(exc, ns=None, filename=STUDENT_FILE):
    """Вернуть словарь с понятным описанием ошибки."""
    etype = type(exc).__name__
    msg = str(exc)
    title = ""
    hint = ""
    line = None
    where = None

    if isinstance(exc, SyntaxError):
        line = exc.lineno
        where = exc.filename
        base = exc.msg or ""
        if isinstance(exc, IndentationError) or isinstance(exc, getattr(builtins, "TabError", IndentationError)):
            title = "Ошибка отступов"
            hint = ("Внутри блока (после строки с двоеточием `:`) все строки должны иметь одинаковый отступ — "
                    "обычно 4 пробела. Проверьте строку %s и соседние." % line)
            if "unexpected indent" in base:
                hint = "Лишний отступ в начале строки %s: строка не должна быть сдвинута вправо." % line
            elif "expected an indented block" in base:
                hint = "После строки с `:` (for, if, def…) ожидается блок со сдвигом на 4 пробела."
        else:
            title = "Синтаксическая ошибка: Python не может прочитать код"
            if "was never closed" in base:
                hint = "Не закрыта скобка. Посчитайте открывающие и закрывающие скобки в строке %s." % line
            elif "unterminated string" in base or "EOL while scanning" in base:
                hint = "Не закрыта кавычка в строке %s." % line
            elif "expected ':'" in base:
                hint = "Пропущено двоеточие `:` в конце строки с for / if / def / while."
            elif "forgot a comma" in base:
                hint = "Похоже, пропущена запятая между элементами."
            elif "unmatched" in base:
                hint = "Лишняя закрывающая скобка в строке %s." % line
            elif "cannot assign" in base:
                hint = "Слева от `=` должно стоять имя переменной (или элемент), а не выражение. Для сравнения используйте `==`."
            elif "invalid character" in base:
                hint = "В коде есть недопустимый символ (например, русская «ё», длинное тире или кавычки-ёлочки). Используйте обычные `'` или `\"`."
            elif "unexpected EOF" in base or "incomplete input" in base:
                hint = "Код оборвался: не хватает закрывающей скобки или тела блока."
            elif "'return' outside function" in base:
                hint = "`return` можно использовать только внутри функции (`def`)."
            else:
                hint = "Проверьте строку %s: скобки, двоеточия, кавычки, запятые." % line
        msg = base
    elif isinstance(exc, NameError):
        name_m = re.search(r"name '([^']+)' is not defined", msg)
        name = name_m.group(1) if name_m else "?"
        title = "Имя `%s` не определено" % name
        libs = {"np": "import numpy as np", "pd": "import pandas as pd", "plt": "import matplotlib.pyplot as plt",
                "sns": "import seaborn as sns", "px": "import plotly.express as px"}
        if name in libs:
            hint = "Сначала импортируйте библиотеку: `%s`." % libs[name]
        else:
            cands = difflib.get_close_matches(name, [k for k in (ns or {}) if not k.startswith("_")], n=3)
            if cands:
                hint = "Возможно, вы имели в виду: %s. " % ", ".join("`%s`" % c for c in cands)
            hint += ("Переменная должна быть создана выше по коду (присваиванием `%s = ...`). "
                     "Проверьте опечатки и регистр букв." % name)
        if isinstance(exc, UnboundLocalError):
            title = "Переменная используется до присваивания"
            hint = "Внутри функции переменной присваивается значение позже, чем она используется. Передайте её как аргумент или присвойте раньше."
    elif isinstance(exc, KeyError) and isinstance(exc.args[0] if exc.args else None, str) and (
            exc.args[0][:1] in "\"'" or "\n" in exc.args[0]):
        # str.format принял фигурные скобки текста (например, пример JSON) за место для подстановки
        title = "Фигурные скобки в шаблоне"
        hint = ("`str.format` считает всё в фигурных скобках местом для подстановки, поэтому ищет значение для %r. "
                "Чтобы вписать в текст саму скобку — например, пример JSON, — удвойте её: `{{` и `}}`." % (exc.args[0],))
    elif isinstance(exc, KeyError):
        key = exc.args[0] if exc.args else "?"
        title = "Ключа или колонки %r нет" % (key,)
        cols = _dataframe_columns(ns)
        if isinstance(key, tuple) and cols and all(str(k) in cols for k in key):
            title = "Несколько колонок нужно передать списком"
            hint = ("Запись `df[%s]` ищет одну колонку с составным именем. Выберите колонки списком, "
                    "в двойных скобках: `df[[%s]]`." % (", ".join(repr(k) for k in key), ", ".join(repr(k) for k in key)))
        elif isinstance(key, (int, float)) and not isinstance(key, bool) and cols:
            title = "Метки %r нет в индексе" % (key,)
            hint = ("`loc` (и выбор строки по метке) ищет строку по метке индекса, а не по номеру. После фильтрации "
                    "или сортировки метки и номера расходятся. Строку по номеру в текущем порядке выбирает `iloc[%s]`; "
                    "если это была колонка, проверьте название в `df.columns`." % (key,))
        else:
            cands = difflib.get_close_matches(str(key), cols, n=3, cutoff=0.5) if cols else []
            if cands:
                hint = "Похожие колонки: %s. " % ", ".join("`%s`" % c for c in cands)
            hint += ("Проверьте название через `df.columns` (или ключи словаря через `.keys()`): важны регистр, "
                     "пробелы и скобки, например `'Price(euro)'`.")
    elif isinstance(exc, IndexError):
        title = "Индекс за пределами"
        m = re.search(r"index (-?\d+) is out of bounds for axis (\d+) with size (\d+)", msg)
        if m:
            i, ax, size = m.groups()
            hint = ("Индекс %s выходит за границы оси %s длиной %s: допустимы позиции от 0 до %d "
                    "(или от -%s до -1)." % (i, ax, size, int(size) - 1, size))
        elif "too many indices" in msg:
            hint = "Слишком много индексов: у массива меньше осей. Проверьте `.shape` и `.ndim`."
        elif "list index out of range" in msg:
            hint = "В списке нет элемента с таким номером. Нумерация начинается с 0; последний элемент — `[-1]`."
        elif "single positional indexer is out-of-bounds" in msg:
            hint = "Позиция в `.iloc[...]` больше числа строк. Проверьте `len(df)`."
        else:
            hint = "Нумерация начинается с 0, последний элемент — `[-1]`. Проверьте длину через `len(...)` или `.shape`."
    elif isinstance(exc, ValueError):
        title = "Неподходящее значение"
        m = re.search(r"operands could not be broadcast together with shapes (\([^)]*\)) (\([^)]*\))", msg)
        if m:
            title = "Размеры массивов не совпадают"
            hint = ("Формы %s и %s несовместимы для поэлементной операции. Массивы и маски должны быть "
                    "одной длины — проверьте, что они получены из одной таблицы и одинаково отфильтрованы." % m.groups())
        elif "encountered in format string" in msg or "unmatched '{' in format" in msg:
            title = "Одиночная фигурная скобка в шаблоне"
            hint = ("В шаблоне для `str.format` фигурные скобки идут парами вокруг имени: `{question}`. "
                    "Чтобы вписать в текст саму скобку, удвойте её: `{{` и `}}`.")
        elif "truth value of" in msg and "ambiguous" in msg:
            title = "Нельзя проверить массив целиком через if / and / or"
            hint = ("Для поэлементных условий используйте `&` (и), `|` (или), `~` (не) и скобки: "
                    "`(a > 1) & (b < 2)`; вместо `not маска` — `~маска`. Для проверки «есть ли хоть один» — `.any()`, "
                    "«все ли» — `.all()`.")
        elif "Buffer dtype mismatch" in msg:
            title = "Значения не совпадают с таблицей по индексу"
            hint = ("Похоже, результат группировки (одна строка на группу) подставлен туда, где нужно значение для каждой "
                    "строки таблицы. Для статистики группы в каждой строке есть `transform`: "
                    "`df.groupby(...)['колонка'].transform('median')`.")
        elif "[0, 1]" in msg and ("percentile" in msg.lower() or "quantile" in msg.lower()):
            title = "Уровень квантиля должен быть от 0 до 1"
            hint = ("Квантиль 99 % записывают как 0.99: `s.quantile(0.99)`, квартили — `s.quantile([0.25, 0.75])`. "
                    "Проценты от 0 до 100 принимает только `np.percentile(a, 99)`.")
        elif "Location based indexing can only have" in msg:
            title = "iloc понимает только номера позиций"
            hint = ("В `iloc[...]` передавайте позиции: числа, срезы чисел, списки чисел. Для имён колонок используйте `loc`: "
                    "`df.loc[0:5, 'Make']`, или номер колонки: `df.iloc[0:5, 0]`.")
        elif "could not convert string to float" in msg:
            title = "Строку нельзя превратить в число"
            hint = ("В данных есть текст там, где ожидалось число. Для моделей закодируйте категориальные колонки "
                    "или выберите только числовые признаки.")
        elif "Expected 2D array, got 1D array" in msg or "Expected a 2-dimensional container" in msg:
            title = "Модели нужна таблица признаков (2D)"
            hint = "Передайте `df[['колонка']]` (двойные скобки) или `x.reshape(-1, 1)`, а не одномерный вектор."
        elif "inconsistent numbers of samples" in msg:
            title = "Разное число строк в X и y"
            hint = "Признаки и ответы должны описывать одни и те же объекты: проверьте `len(X)` и `len(y)`."
        elif "Input X contains NaN" in msg or "Input contains NaN" in msg or "Input y contains NaN" in msg:
            title = "В данных для модели есть пропуски (NaN)"
            hint = "Удалите или заполните пропуски до обучения: `dropna()` или `fillna(...)`."
        elif "Length of values" in msg and "does not match length of index" in msg:
            title = "Длина значений не совпадает с числом строк"
            hint = "Новая колонка должна иметь ровно столько значений, сколько строк в таблице."
        elif "must have same first dimension" in msg or "must be the same size" in msg:
            title = "Разное число точек по осям графика"
            hint = "Векторы для x и y должны быть одной длины."
        elif "cannot reshape array" in msg:
            hint = "Новая форма должна содержать столько же элементов, сколько исходный массив."
        elif "math domain error" in msg:
            hint = "Функция не определена для этого значения (например, логарифм или корень из отрицательного числа)."
        elif "invalid literal for int()" in msg:
            hint = "Строку нельзя превратить в целое число. Проверьте содержимое строки."
        elif "Columns must be same length as key" in msg:
            hint = "Количество новых колонок слева от `=` должно совпадать с количеством колонок справа."
        else:
            hint = "Функция получила значение, с которым не может работать. Прочитайте сообщение ниже и проверьте аргументы."
    elif isinstance(exc, (TypeError, AttributeError, ValueError)) and "ellipsis" in msg:
        title = "В коде остался заполнитель «...»"
        hint = ("Многоточие `...` в заготовке — место для вашего решения. Замените его на вычисление, "
                "иначе следующие строки не могут работать с результатом.")
    elif isinstance(exc, TypeError):
        title = "Неподходящий тип данных"
        m = re.search(r"unsupported operand type\(s\) for (.+?): '(\w+)' and '(\w+)'", msg)
        if re.search(r"Cannot perform '(r?and_|r?or_|rand_|ror_)'", msg) or (
                m and m.group(1).strip() in ("&", "|") and ("Array" in msg or "Series" in msg or "str" in msg)):
            title = "Не хватает скобок вокруг условий"
            hint = ("Операторы `&` и `|` выполняются раньше сравнений, поэтому каждое сравнение нужно взять в скобки: "
                    "`(df['Year'] > 2010) & (df['Price(euro)'] < 5000)`.")
        elif m:
            hint = "Операцию `%s` нельзя применить к типам `%s` и `%s`. Приведите типы, например `int(...)`, `float(...)` или `str(...)`." % m.groups()
        elif "can only concatenate str" in msg:
            hint = "Строку можно сложить только со строкой. Используйте f-строку: `f'Цена: {price}'`."
        elif "'NoneType' has no len()" in msg:
            hint = ("Значение равно `None`. Чаще всего это значит, что функция ничего не вернула: "
                    "проверьте, что в конце функции есть `return`.")
        elif "'NoneType' object is not subscriptable" in msg or "'NoneType' object is not iterable" in msg:
            hint = ("Вы работаете со значением `None`. Возможно, функция не вернула результат (нет `return`) или метод "
                    "изменил объект на месте и вернул None (например, `list.sort()`).")
        elif "object is not callable" in msg:
            m2 = re.search(r"'(\w+)' object is not callable", msg)
            t = m2.group(1) if m2 else "этот"
            hint = ("Объект типа `%s` нельзя вызвать круглыми скобками. Возможно, имя функции перезаписано переменной "
                    "или скобки стоят после атрибута: пишите `.shape`, а не `.shape()`." % t)
        elif "missing" in msg and "required positional argument" in msg:
            hint = "Функции не хватает аргумента. Проверьте, что передали все нужные значения."
        elif "positional argument" in msg and "were given" in msg:
            hint = "Функции передано больше аргументов, чем она принимает."
        elif "unexpected keyword argument" in msg:
            m2 = re.search(r"unexpected keyword argument '(\w+)'", msg)
            hint = "У функции нет параметра `%s`. Проверьте его название в справочнике." % (m2.group(1) if m2 else "")
        elif "list indices must be integers or slices, not tuple" in msg:
            hint = "Список Python не понимает индекс вида `[i, j]` — это синтаксис массивов NumPy. Преобразуйте список: `np.array(...)`."
        elif "indices must be integers" in msg:
            hint = "Индекс должен быть целым числом (или срезом). Преобразуйте число через `int(...)`."
        elif "is not iterable" in msg:
            hint = "По этому значению нельзя пройти циклом. Ожидается список, массив или другая коллекция."
        elif "only integer scalar arrays can be converted" in msg:
            hint = "В индексе ожидается целое число или массив целых, а получено что-то другое."
        elif "unhashable type" in msg:
            hint = "Список или словарь нельзя использовать как ключ словаря или элемент множества. Используйте кортеж."
        elif "incompatible index of inserted column" in msg:
            title = "Индекс новой колонки не совпадает с таблицей"
            hint = ("У новой колонки должны быть те же метки строк, что у таблицы. Результат группировки содержит по одной "
                    "строке на группу — для значения группы в каждой строке используйте `transform`.")
        elif "Cannot perform" in msg and "with a dtyped" in msg:
            hint = "Операция не поддерживается для этого типа колонки. Проверьте `df.dtypes`."
        else:
            hint = "Значение не того типа. Проверьте типы переменных через `type(x)`."
    elif isinstance(exc, AttributeError):
        m = re.search(r"'(\w+)' object has no attribute '(\w+)'", msg)
        if m:
            t, attr = m.groups()
            title = "У объекта типа `%s` нет атрибута `%s`" % (t, attr)
            if t == "NoneType":
                hint = "Значение равно `None`: возможно, функция не вернула результат или метод изменил объект на месте."
            elif t in ("DataFrame", "Series"):
                hint = ("Если это колонка, обращайтесь через квадратные скобки: `df['%s']`, и проверьте название в `df.columns`." % attr)
            else:
                hint = "Проверьте название атрибута или метода (регистр, опечатки) в справочнике."
                obj_attrs = []
                try:
                    # ищем объект этого типа в пространстве имён
                    for v in (ns or {}).values():
                        if type(v).__name__ == t:
                            obj_attrs = [a for a in dir(v) if not a.startswith("_")]
                            break
                except Exception:
                    pass
                cands = difflib.get_close_matches(attr, obj_attrs, n=3)
                if cands:
                    hint = "Возможно, вы имели в виду: %s." % ", ".join("`%s`" % c for c in cands)
        else:
            title = "Нет такого атрибута"
            hint = "Проверьте название атрибута или модуля."
    elif isinstance(exc, ZeroDivisionError):
        title = "Деление на ноль"
        hint = "Знаменатель равен нулю. Проверьте, что выборка не пустая, прежде чем делить на её размер."
    elif isinstance(exc, ModuleNotFoundError) and getattr(exc, "name", None) in ("torch", "tensorflow", "keras"):
        title = "Библиотеки глубокого обучения в браузере нет"
        hint = ("PyTorch, TensorFlow и Keras в браузере не работают. Для уроков модуля 9 есть браузерная версия transformers: "
                "токенизатор возвращает массивы NumPy (`return_tensors='np'`), softmax считаем в NumPy. "
                "Настоящие библиотеки — в Colab.")
    elif isinstance(exc, ModuleNotFoundError):
        title = "Модуль не найден"
        hint = "В браузерной версии Python доступны: %s. Проверьте название модуля." % _KNOWN_MODULES
    elif isinstance(exc, ImportError):
        title = "Не удалось импортировать"
        hint = "Проверьте название функции или класса в строке импорта."
    elif isinstance(exc, FileNotFoundError):
        title = "Файл не найден"
        try:
            files = sorted(f for f in os.listdir(".") if not f.startswith("."))
        except Exception:
            files = []
        hint = "Доступные файлы: %s. Проверьте имя файла." % (", ".join(files) if files else "нет")
    elif isinstance(exc, RecursionError):
        title = "Слишком глубокая рекурсия"
        hint = "Функция вызывает сама себя без остановки. Проверьте условие выхода."
    elif isinstance(exc, MemoryError):
        title = "Не хватило памяти"
        hint = "Код создаёт слишком большой объект. Уменьшите размер данных."
    elif isinstance(exc, OverflowError):
        title = "Слишком большое число"
        hint = "Результат не помещается в тип данных."
    elif isinstance(exc, AssertionError):
        title = "Сработала проверка assert в вашем коде"
        hint = "Условие в `assert` оказалось ложным."
    elif isinstance(exc, KeyboardInterrupt):
        title = "Выполнение остановлено"
        hint = ""
    elif etype == "BrowserLimitation":
        title = "Недоступно в браузерной версии"
        hint = ("Этот шаг требует настоящей модели или библиотеки transformers. В браузере работает учебная версия: "
                "настоящий токенизатор и заранее посчитанные результаты моделей. Сообщение ниже объясняет, что доступно.")
    else:
        title = "Ошибка %s" % etype
        hint = "Прочитайте сообщение ниже: оно указывает, что пошло не так."

    if line is None and exc.__traceback__ is not None:
        frames = _student_frames(exc.__traceback__)
        if frames:
            line = frames[-1].lineno
            where = frames[-1].filename
    # заполнитель «...» в строке (или многострочном выражении), где произошла ошибка
    if exc.__traceback__ is not None and not isinstance(exc, (SyntaxError, KeyboardInterrupt)):
        frames = _student_frames(exc.__traceback__)
        if frames:
            fr = frames[-1]
            src_lines = linecache.getlines(fr.filename)
            last = getattr(fr, "end_lineno", None) or fr.lineno
            chunk = "".join(src_lines[max(fr.lineno - 1, 0):last]) if src_lines else (fr.line or "")
            if "..." in re.sub(r"(['\"]).*?\1", "", chunk):
                title = "В коде остался заполнитель «...»"
                hint = ("Многоточие `...` в заготовке — место для вашего решения. Замените его на вычисление, "
                        "иначе следующие строки не могут работать с результатом.")
            elif isinstance(exc, (TypeError, ValueError, AttributeError, KeyError, IndexError)):
                # многоточие осталось в другой строке (например, элементом списка), а ошибка — дальше
                ell = _ellipsis_lines(fr.filename)
                if ell:
                    title = "В коде остался заполнитель «...»"
                    hint = ("Многоточие `...` в строке %d — место для вашего решения. Замените его: "
                            "ошибка ниже, скорее всего, вызвана им." % ell[0])
        all_frames = traceback.extract_tb(exc.__traceback__)
        if (isinstance(exc, AssertionError) and title.startswith("Сработала") and all_frames
                and all_frames[-1].filename not in (STUDENT_FILE, PRELUDE_FILE, SETUP_FILE)):
            title = "Ошибка внутри библиотеки"
            hint = "Функция библиотеки получила неподходящие данные. Проверьте значения в указанной строке вашего кода."
    return {
        "type": etype,
        "message": msg,
        "title": title,
        "hint": hint,
        "line": line,
        "where": where,
        "traceback": _clean_traceback(exc),
    }


# ---------------------------------------------------------------------------
# Режим run: примеры в теории и запуск кода ученика
# ---------------------------------------------------------------------------
_namespaces = {}
# Фильтры предупреждений, которые задали setup и примеры (например, warnings.filterwarnings в setup урока).
# Каждый запуск идёт внутри catch_warnings(), поэтому фильтры сохраняем по пространству имён
# и восстанавливаем перед следующим запуском — как в ноутбуке, где они действуют на все ячейки.
_ns_filters = {}


def _new_filters(before_len):
    """Фильтры, добавленные после снимка: filterwarnings и simplefilter вставляют их в начало списка."""
    added = len(warnings.filters) - before_len
    return list(warnings.filters[:added]) if added > 0 else []


def _reapply_filters(entries):
    for action, msg, cat, mod, lineno in reversed(entries):
        warnings.filterwarnings(action, message=msg.pattern if msg is not None else "", category=cat,
                                module=mod.pattern if mod is not None else "", lineno=lineno)


def _ensure_ns(key, setup, reset):
    if reset or key not in _namespaces:
        ns = new_namespace()
        _namespaces[key] = ns
        _ns_filters[key] = []
        if setup:
            out = Output()
            with _capture(out), _cwd(WORK_DIR):
                before = len(warnings.filters)
                _prepare_imports(setup)
                exec_cell(setup, ns, SETUP_FILE, show_last=False)
                _ns_filters[key] = _new_filters(before)
    return _namespaces[key]


def run(payload):
    out = Output()
    key = payload.get("ns") or "default"
    code = payload.get("code", "")
    result = {"ok": True, "outputs": out.items, "error": None}
    del _captured_figures[:]
    del _captured_plotly[:]
    _stage_files(payload.get("files"))
    try:
        ns = _ensure_ns(key, payload.get("setup") or "", payload.get("reset", False))
    except BaseException as e:  # ошибка в подготовке
        result["ok"] = False
        result["error"] = explain_error(e, None, SETUP_FILE)
        return result
    with _capture(out), _cwd(WORK_DIR):
        kept = _ns_filters.get(key, [])
        _reapply_filters(kept)
        before = len(warnings.filters)
        try:
            _prepare_imports(code)
            exec_cell(code, ns, payload.get("filename") or STUDENT_FILE)
            _patch_libraries()
        except BaseException as e:
            result["ok"] = False
            result["error"] = explain_error(e, ns)
        finally:
            _ns_filters[key] = _new_filters(before) + kept
            try:
                _flush_figures(out)
            except Exception:
                pass
    return result


# ---------------------------------------------------------------------------
# Режим submission: решение соревнования → таблица прогнозов для отправки на сервер
# ---------------------------------------------------------------------------
def _preview(values, n=5):
    vals = [str(v) for v in list(values)[:n]]
    return ", ".join(vals) + (", …" if len(values) > n else "")


def _cars(n):
    """«для 1 машины», «для 21 машины», «для 5 машин» — родительный падеж после числа."""
    return "%d %s" % (n, "машины" if n % 10 == 1 and n % 100 != 11 else "машин")


def _objects(n, forms):
    """«для 1 картинки», «для 5 картинок»: forms — [им. ед., род. ед., род. мн.] из реестра соревнований."""
    return "%d %s" % (n, forms[1] if n % 10 == 1 and n % 100 != 11 else forms[2])


def _collect_label_submission(sub, comp, id_col, pred_col):
    """Соревнование с классами: ID — строки проверочной таблицы, ответы — названия классов из списка."""
    import pandas as pd

    forms = comp.get("objectForms") or ["картинка", "картинки", "картинок"]
    test_file = comp.get("testFile")
    labels = set(comp.get("labels") or [])
    if sub[id_col].isna().any():
        return ("В колонке `%s` есть пустые значения (%d шт.). ID берите из колонки `%s` проверочной таблицы." % (
            id_col, int(sub[id_col].isna().sum()), id_col), None)
    ids = sub[id_col].astype(str)
    dup = ids[ids.duplicated()].unique()
    if len(dup):
        return ("Повторяются ID: %s. У каждой картинки должен быть ровно один ответ — не удаляйте и не размножайте строки проверочной таблицы." % _preview(dup), None)
    if test_file and os.path.exists(os.path.join(WORK_DIR, test_file)):
        expected = pd.read_csv(os.path.join(WORK_DIR, test_file), usecols=[id_col], dtype=str)[id_col]
        exp_set, got_set = set(expected.tolist()), set(ids.tolist())
        lost = sorted(exp_set - got_set)
        extra = sorted(got_set - exp_set)
        if lost:
            return ("Нет ответов для %s из %d (ID %s). Ответ нужен для каждой строки проверочной таблицы." % (
                _objects(len(lost), forms), len(exp_set), _preview(lost)), None)
        if extra:
            return ("Лишние ID, которых нет в проверочной таблице: %s. ID берите из колонки `%s` проверочной таблицы как есть." % (
                _preview(extra), id_col), None)
    preds = sub[pred_col]
    if preds.isna().any():
        return ("У %s нет ответа (пустое значение), например у ID %s." % (
            _objects(int(preds.isna().sum()), forms), _preview(ids[preds.isna()].tolist())), None)
    preds = preds.astype(str)
    if labels:
        unknown = ~preds.isin(labels)
        if unknown.any():
            examples = list(dict.fromkeys(preds[unknown].tolist()))
            return ("Неизвестные классы у %s: %s. Ответ — название класса точно как в колонке `class` (например, «phoenicopterus-ruber»), "
                    "а не перевод или подпись. Если вы выбирали среди подписей, верните класс, которому подпись принадлежит." % (
                        _objects(int(unknown.sum()), forms), _preview(examples, 3)), None)
    return ("", {"ids": ids.tolist(), "predictions": preds.tolist()})


def _collect_choice_submission(sub, comp, id_col, pred_col):
    """Тест с вариантами ответа: ID — целые числа проверочной таблицы, ответы — номера вариантов (целые)."""
    import numpy as np
    import pandas as pd

    forms = comp.get("objectForms") or ["вопрос", "вопроса", "вопросов"]
    test_file = comp.get("testFile")
    ids = pd.to_numeric(sub[id_col], errors="coerce")
    if ids.isna().any():
        return ("В колонке `%s` есть пустые или нечисловые значения (%d шт.). ID берите из колонки `%s` теста." % (
            id_col, int(ids.isna().sum()), id_col), None)
    if not np.all(np.mod(ids.to_numpy(dtype=float), 1) == 0):
        return ("ID должны быть целыми числами — возьмите их из колонки `%s` теста." % id_col, None)
    ids = ids.astype("int64")
    dup = ids[ids.duplicated()].unique()
    if len(dup):
        return ("Повторяются ID: %s. На каждый вопрос нужен ровно один ответ — не удаляйте и не размножайте строки теста." % _preview(dup), None)
    if test_file and os.path.exists(os.path.join(WORK_DIR, test_file)):
        expected = pd.read_csv(os.path.join(WORK_DIR, test_file), usecols=[id_col])[id_col].astype("int64")
        exp_set, got_set = set(expected.tolist()), set(ids.tolist())
        lost = sorted(exp_set - got_set)
        extra = sorted(got_set - exp_set)
        if lost:
            return ("Нет ответов для %s из %d (ID %s). Ответ нужен на каждый вопрос теста — даже если модель не ответила, поставьте запасной номер." % (
                _objects(len(lost), forms), len(exp_set), _preview(lost)), None)
        if extra:
            return ("Лишние ID, которых нет в тесте: %s." % _preview(extra), None)
    preds = pd.to_numeric(sub[pred_col], errors="coerce")
    if preds.isna().any():
        return ("У %s нет ответа или он не число, например у ID %s. Если ответ модели не разобрался, поставьте запасной номер варианта." % (
            _objects(int(preds.isna().sum()), forms), _preview(ids[preds.isna()].tolist())), None)
    values = preds.to_numpy(dtype=float)
    frac = np.mod(values, 1) != 0
    if frac.any():
        return ("Номер варианта — целое число, а у %s ответ дробный (например, у ID %s: %s)." % (
            _objects(int(frac.sum()), forms), _preview(ids[frac].tolist(), 3), _fmt(float(values[frac][0]))), None)
    huge = np.abs(values) > 1_000_000
    if huge.any():
        return ("У %s ответ — не номер варианта (например, у ID %s: %s)." % (
            _objects(int(huge.sum()), forms), _preview(ids[huge].tolist(), 3), _fmt(float(values[huge][0]))), None)
    return ("", {"ids": ids.tolist(), "predictions": [int(v) for v in values]})


def _collect_submission(ns, comp):
    """Проверить переменную submission и вернуть (сообщение об ошибке, данные для отправки)."""
    import numpy as np
    import pandas as pd

    id_col = comp.get("idColumn") or "ID"
    pred_col = comp.get("predictionColumn") or "Predict"
    test_file = comp.get("testFile")
    lo, hi = (comp.get("range") or [-1e18, 1e18])[:2]
    label_mode = comp.get("predictionType") == "label"
    choice_mode = comp.get("predictionType") == "choice"
    example = "submission = pd.DataFrame({'%s': test['%s'], '%s': %s})" % (
        id_col, id_col, pred_col, "ответы" if (label_mode or choice_mode) else "прогнозы")

    if "submission" not in ns or ns["submission"] is Ellipsis:
        return ("Не найдена таблица `submission`. Соберите её в конце кода: `%s`." % example, None)
    sub = ns["submission"]
    if isinstance(sub, pd.Series):
        return ("`submission` — это Series, а нужна таблица DataFrame с колонками `%s` и `%s`: `%s`." % (id_col, pred_col, example), None)
    if not isinstance(sub, pd.DataFrame):
        return ("`submission` должна быть таблицей DataFrame, а сейчас это %s." % _type_name(sub), None)
    missing_cols = [c for c in (id_col, pred_col) if c not in sub.columns]
    if missing_cols:
        return ("В `submission` нет колонки %s. Сейчас колонки: %s. Нужны ровно `%s` и `%s`." % (
            ", ".join("`%s`" % c for c in missing_cols), ", ".join("`%s`" % c for c in sub.columns) or "нет", id_col, pred_col), None)
    if label_mode:
        return _collect_label_submission(sub, comp, id_col, pred_col)
    if comp.get("predictionType") == "choice":
        return _collect_choice_submission(sub, comp, id_col, pred_col)

    ids = pd.to_numeric(sub[id_col], errors="coerce")
    if ids.isna().any():
        return ("В колонке `%s` есть пустые или нечисловые значения (%d шт.)." % (id_col, int(ids.isna().sum())), None)
    if not np.all(np.mod(ids.to_numpy(dtype=float), 1) == 0):
        return ("ID должны быть целыми числами — возьмите их из колонки `%s` проверочной таблицы." % id_col, None)
    ids = ids.astype("int64")
    dup = ids[ids.duplicated()].unique()
    if len(dup):
        return ("Повторяются ID: %s. У каждой машины должен быть ровно один прогноз — не удаляйте и не размножайте строки проверочной таблицы." % _preview(dup), None)

    if test_file and os.path.exists(os.path.join(WORK_DIR, test_file)):
        expected = pd.read_csv(os.path.join(WORK_DIR, test_file), usecols=[id_col])[id_col].astype("int64")
        exp_set, got_set = set(expected.tolist()), set(ids.tolist())
        lost = sorted(exp_set - got_set)
        extra = sorted(got_set - exp_set)
        if lost:
            return ("Нет прогнозов для %s из %d (ID %s). Не удаляйте строки проверочной таблицы: пропуски в признаках заполните, а прогноз нужен для каждой машины." % (
                _cars(len(lost)), len(exp_set), _preview(lost)), None)
        if extra:
            return ("Лишние ID, которых нет в проверочной таблице: %s." % _preview(extra), None)

    preds = pd.to_numeric(sub[pred_col], errors="coerce").to_numpy(dtype=float)
    bad = ~np.isfinite(preds)
    if bad.any():
        return ("У %s прогноз — не число (NaN или бесконечность), например у ID %s. Проверьте, нет ли пропусков в признаках проверочной таблицы." % (
            _cars(int(bad.sum())), _preview(ids[bad].tolist())), None)
    out_of_range = (preds < lo) | (preds > hi)
    if out_of_range.any():
        return ("Прогнозы вне допустимого диапазона от %s до %s у %s (например, ID %s: %s). Если модель училась на логарифме цены, верните прогноз в исходную шкалу: `np.exp(...)`." % (
            _fmt(lo), _fmt(hi), _cars(int(out_of_range.sum())), _preview(ids[out_of_range].tolist(), 3), _fmt(float(preds[out_of_range][0]))), None)
    return ("", {"ids": ids.tolist(), "predictions": [float(v) for v in preds]})


def submission(payload):
    res = run(payload)
    out = {"ok": False, "outputs": res["outputs"], "error": res["error"], "message": "", "submission": None}
    if not res["ok"]:
        out["message"] = "Код завершился с ошибкой — исправьте её и отправьте снова."
        return out
    ns = _namespaces.get(payload.get("ns") or "default", {})
    try:
        msg, data = _collect_submission(ns, payload.get("competition") or {})
    except BaseException as e:  # pragma: no cover
        msg, data = ("Не удалось прочитать таблицу submission: %s" % e, None)
    out["message"] = msg
    out["submission"] = data
    out["ok"] = data is not None
    return out


# ---------------------------------------------------------------------------
# Режим check: проверка задания
# ---------------------------------------------------------------------------
class CheckFailed(Exception):
    """Тест не пройден: сообщение показывается ученику."""


HARDCODE_MSG = ("На другой части данных ваш код дал {actual}, а должно получиться {expected}. "
                "Похоже, результат вписан вручную — вычислите его из данных.")


def _fmt(v):
    try:
        if _is_int(v):
            return str(int(v))
        if type(v).__name__ in ("bool_", "bool"):
            return str(bool(v))
        if isinstance(v, (float,)) or type(v).__name__.startswith("float"):
            fv = float(v)
            if math.isnan(fv):
                return "nan"
            if abs(fv) >= 1e6 or (abs(fv) < 1e-3 and fv != 0):
                return "%.6g" % fv
            return ("%.4f" % fv).rstrip("0").rstrip(".")
        if type(v).__name__ == "ndarray":
            import numpy as np
            return np.array2string(v, threshold=8, precision=4, suppress_small=True)
    except Exception:
        pass
    r = _safe_repr(v)
    return r if len(r) < 300 else r[:300] + "…"


def _type_name(v):
    t = type(v)
    names = {"int": "целое число (int)", "float": "дробное число (float)", "str": "строка (str)",
             "list": "список (list)", "dict": "словарь (dict)", "tuple": "кортеж (tuple)",
             "bool": "логическое значение (bool)", "ndarray": "массив NumPy (ndarray)",
             "DataFrame": "таблица pandas (DataFrame)", "Series": "столбец pandas (Series)",
             "NoneType": "None (пустое значение)", "ellipsis": "многоточие `...`"}
    return names.get(t.__name__, t.__name__)


class _VariantRunner:
    """Запуск кода на изменённой части данных (защита от подгонки ответа)."""

    def __init__(self, files):
        self.files = files or []

    def ensure_variant(self, name):
        """Подготовить папку с изменённой частью данных и вернуть путь к рабочей копии."""
        master = os.path.join(VARIANT_ROOT, name, "master")
        work = os.path.join(VARIANT_ROOT, name, "run")
        self._build_master(name, master)
        os.makedirs(work, exist_ok=True)
        for f in self.files:  # рабочая копия заново перед каждым запуском (код мог перезаписать файлы)
            src = os.path.join(master, f)
            if os.path.exists(src):
                with open(src, "rb") as fs, open(os.path.join(work, f), "wb") as fd:
                    fd.write(fs.read())
        return work

    def _build_master(self, name, root):
        os.makedirs(root, exist_ok=True)
        seed = 12345 if name == "alt" else sum(ord(ch) * (i + 1) for i, ch in enumerate(name))
        frac = 0.7 if name == "alt" else 0.5
        kept = {}
        # сначала таблицы: по их выбранным строкам урезаются парные массивы <имя>.npy (эмбеддинги тех же объектов)
        for f in sorted(self.files, key=lambda x: not x.lower().endswith(".csv")):
            src = os.path.join(DATA_DIR, f)
            dst = os.path.join(root, f)
            if os.path.exists(dst):
                continue
            if not os.path.exists(src):
                continue
            low = f.lower()
            if low.endswith(".csv"):
                kept[f[:-4]] = _write_variant_csv(src, dst, seed, frac)
            elif low.endswith(".npy") and f[:-4] in kept:
                import numpy as np
                np.save(dst, np.load(src)[kept[f[:-4]]])
            elif low.endswith(".txt") and not low.endswith("_vocab.txt"):
                _write_variant_lines(src, dst, seed, frac)
            else:
                with open(src, "rb") as fs, open(dst, "wb") as fd:
                    fd.write(fs.read())
        return root



_FLOAT_RE = re.compile(r"^-?\d+\.\d+$")


def _write_variant_csv(src, dst, seed, frac):
    """Изменённая часть данных: случайные 70% строк и небольшое изменение дробных чисел.

    Дробные поля (цены, пробеги, объёмы — в файле записаны как «7750.0») умножаются на множитель
    1.001…1.011, зависящий от строки. Целые поля (год) и текст не меняются, нули остаются нулями.
    Так вписанные вручную ответы перестают совпадать даже для устойчивых статистик вроде медианы.
    """
    import csv as _csv
    with open(src, encoding="utf-8", newline="") as fh:
        rows = list(_csv.reader(fh))
    header, body = rows[:1], rows[1:]
    rnd = random.Random(seed)
    keep = sorted(rnd.sample(range(len(body)), int(len(body) * frac)))
    out = []
    for k, i in enumerate(keep):
        row = list(body[i])
        factor = 1 + ((i * 37) % 11 + 1) / 1000.0
        for j, v in enumerate(row):
            if _FLOAT_RE.match(v):
                row[j] = repr(round(float(v) * factor, 2))
        out.append(row)
    with open(dst, "w", encoding="utf-8", newline="") as fh:
        w = _csv.writer(fh, lineterminator="\n")
        w.writerows(header + out)
    return keep


def _write_variant_lines(src, dst, seed, frac):
    """Текстовый корпус (строка = абзац): случайные 70% строк в исходном порядке. Словари (*_vocab.txt) не трогаем."""
    with open(src, encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    rnd = random.Random(seed)
    keep = sorted(rnd.sample(range(len(lines)), int(len(lines) * frac)))
    with open(dst, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines[i] for i in keep) + "\n")

def _check_no_ellipsis_inside(name, v):
    """Колонка таблицы, заполненная многоточием из заготовки (`df['x'] = ...`), — понятное сообщение."""
    tname = type(v).__name__
    if isinstance(v, dict):
        for key, item in v.items():
            if item is Ellipsis:
                raise CheckFailed("В словаре `%s` по ключу %r осталось многоточие `...` — замените его на вычисление."
                                  % (name, key))
        return
    if isinstance(v, (list, tuple)):
        if any(item is Ellipsis for item in v):
            raise CheckFailed("В `%s` осталось многоточие `...` — замените его на вычисление." % name)
        return
    if tname not in ("DataFrame", "Series"):
        return
    try:
        cols = [(c, v[c]) for c in v.columns] if tname == "DataFrame" else [(None, v)]
        for c, s in cols:
            if str(s.dtype) == "object" and len(s) and any(x is Ellipsis for x in s.head(50)):
                if c is None:
                    raise CheckFailed("В `%s` записано многоточие `...` — замените его на вычисление." % name)
                raise CheckFailed("В колонку `%s` таблицы `%s` записано многоточие `...` — замените его на вычисление."
                                  % (c, name))
    except CheckFailed:
        raise
    except Exception:
        return


class TaskCheck:
    def __init__(self, payload):
        self.p = payload
        self.prelude = payload.get("prelude") or ""
        self.code = payload.get("code") or ""
        self.solution = payload.get("solution") or ""
        self.files = payload.get("files") or []
        self.variants = _VariantRunner(self.files)
        self.student_ns = None
        self.student_stdout = ""
        self._ref = None
        self._alt = {}
        self._alt_ref = {}

    # --- запуск ---
    def _run_program(self, code, filename, workdir, out):
        ns = new_namespace()
        self._partial_ns = ns  # для понятного сообщения об ошибке: какие переменные уже были созданы
        with _capture(out), _cwd(workdir):
            if self.prelude.strip():
                _prepare_imports(self.prelude)
                exec_cell(self.prelude, ns, PRELUDE_FILE, show_last=False)
            _prepare_imports(code)
            exec_cell(code, ns, filename)
            _patch_libraries()
        return ns

    def ref_ns(self):
        if self._ref is None:
            out = Output(enabled=False)
            figs_before = list(_captured_figures)
            plotly_before = list(_captured_plotly)
            _stage_files(self.files)  # код ученика мог перезаписать файлы данных
            try:
                self._ref = self._run_program(self.solution, SOLUTION_FILE, WORK_DIR, out)
            except BaseException as e:
                raise RuntimeError("Эталонное решение завершилось с ошибкой: %r" % e)
            finally:
                plt = sys.modules.get("matplotlib.pyplot")
                if plt is not None:
                    # фигуры эталона не должны смешиваться с фигурами ученика
                    for num in list(plt.get_fignums()):
                        fig = plt.figure(num)
                        if fig not in figs_before:
                            plt.close(fig)
                del _captured_figures[:]
                _captured_figures.extend(figs_before)
                del _captured_plotly[:]
                _captured_plotly.extend(plotly_before)
        return self._ref

    def _variant_ns(self, which, variant):
        cache = self._alt if which == "student" else self._alt_ref
        if variant not in cache:
            root = self.variants.ensure_variant(variant)
            out = Output(enabled=False)
            figs_before = list(_captured_figures)
            plotly_before = list(_captured_plotly)
            code = self.code if which == "student" else self.solution
            fname = STUDENT_FILE if which == "student" else SOLUTION_FILE
            try:
                cache[variant] = self._run_program(code, fname, root, out)
            except CheckFailed:
                raise
            except BaseException as e:
                if which == "student":
                    info = explain_error(e, None)
                    raise CheckFailed("На другой части данных ваш код завершился с ошибкой: %s — %s. "
                                      "Возможно, в коде вписаны числа, которые подходят только к полному файлу "
                                      "(номера строк, размеры), — вычисляйте их из данных."
                                      % (info["title"], info["message"]))
                raise RuntimeError("Эталон на другой части данных завершился с ошибкой: %r" % e)
            finally:
                plt = sys.modules.get("matplotlib.pyplot")
                if plt is not None:
                    for num in list(plt.get_fignums()):
                        fig = plt.figure(num)
                        if fig not in figs_before:
                            plt.close(fig)
                del _captured_figures[:]
                _captured_figures.extend(figs_before)
                del _captured_plotly[:]
                _captured_plotly.extend(plotly_before)
        return cache[variant]

    # --- помощники, доступные тестам ---
    def helpers(self):
        chk = self

        def fail(msg):
            raise CheckFailed(msg)

        def ensure(cond, msg):
            if not cond:
                raise CheckFailed(msg)

        def var(name, types_=None, desc=None):
            ns = chk.student_ns
            if name not in ns:
                raise CheckFailed("Не найдена переменная `%s`. Создайте её в своём коде: `%s = ...`." % (name, name))
            v = ns[name]
            if v is Ellipsis:
                raise CheckFailed("Переменная `%s` всё ещё равна `...` — замените многоточие на вычисление." % name)
            _check_no_ellipsis_inside(name, v)
            if types_ is not None:
                tnames = types_ if isinstance(types_, (list, tuple)) else [types_]
                ok = False
                for t in tnames:
                    if isinstance(t, str):
                        if type(v).__name__ == t:
                            ok = True
                        elif t == "number" and _is_number(v):
                            ok = True
                        elif t == "int" and _is_int(v):
                            ok = True
                    elif isinstance(v, t):
                        ok = True
                if not ok:
                    raise CheckFailed("Переменная `%s` должна быть %s, а сейчас это %s."
                                      % (name, desc or " или ".join(str(t) for t in tnames), _type_name(v)))
            return v

        def has(name):
            return name in chk.student_ns and chk.student_ns[name] is not Ellipsis

        def ref(name):
            ns = chk.ref_ns()
            if name not in ns:
                raise RuntimeError("В эталоне нет переменной %s" % name)
            return ns[name]

        def alt(name, variant="alt"):
            ns = chk._variant_ns("student", variant)
            if name not in ns:
                raise CheckFailed("На другой части данных переменная `%s` не создаётся." % name)
            return ns[name]

        def alt_ref(name, variant="alt"):
            ns = chk._variant_ns("solution", variant)
            return ns[name]

        def close(actual, expected, msg=None, rtol=1e-6, atol=1e-8):
            if not _is_number(actual):
                raise CheckFailed("Ожидалось число, а получено %s (%s)." % (_fmt(actual), _type_name(actual)))
            a, e = float(actual), float(expected)
            if math.isnan(e) and math.isnan(a):
                return
            if math.isnan(a) or not math.isclose(a, e, rel_tol=rtol, abs_tol=atol):
                text = msg or "Получено {actual}, а ожидалось {expected}."
                raise CheckFailed(text.replace("{actual}", _fmt(actual)).replace("{expected}", _fmt(expected)))

        def equal(actual, expected, msg=None):
            same = False
            try:
                same = bool(actual == expected)
            except Exception:
                same = False
            if not same:
                text = msg or "Получено {actual}, а ожидалось {expected}."
                raise CheckFailed(text.replace("{actual}", _fmt(actual)).replace("{expected}", _fmt(expected)))

        def same_array(actual, expected, msg=None, rtol=1e-6, atol=1e-8, name="массив"):
            import numpy as np
            if not hasattr(actual, "__len__") and not hasattr(actual, "shape"):
                raise CheckFailed("Ожидался %s, а получено %s." % (name, _type_name(actual)))
            a = np.asarray(actual)
            e = np.asarray(expected)
            if a.shape != e.shape:
                raise CheckFailed((msg + " " if msg else "") +
                                  "Форма не совпадает: у вас %s, а нужно %s." % (a.shape, e.shape))
            try:
                ok = np.allclose(a.astype(float), e.astype(float), rtol=rtol, atol=atol, equal_nan=True)
            except (TypeError, ValueError):
                ok = bool(np.all(a == e))
            if not ok:
                try:
                    diff = np.argwhere(~np.isclose(a.astype(float), e.astype(float), rtol=rtol, atol=atol, equal_nan=True))
                except Exception:
                    diff = np.argwhere(a != e)
                pos = tuple(int(x) for x in diff[0]) if len(diff) else ()
                where = ""
                if pos:
                    where = " Первое расхождение в позиции %s: у вас %s, нужно %s." % (
                        pos if len(pos) > 1 else pos[0], _fmt(a[pos]), _fmt(e[pos]))
                raise CheckFailed((msg or "Значения не совпадают.") + where)

        def same_frame(actual, expected, msg=None, check_dtype=False, check_index=True, check_like=False,
                       rtol=1e-5, atol=1e-8):
            """Сравнить таблицы/столбцы pandas и объяснить первое расхождение по-русски."""
            import numpy as np
            import pandas as pd
            prefix = (msg + " ") if msg else ""
            is_df = isinstance(expected, pd.DataFrame)
            if is_df and not isinstance(actual, pd.DataFrame):
                raise CheckFailed(prefix + "Ожидалась таблица (DataFrame), а получено %s." % _type_name(actual))
            if not is_df and not isinstance(actual, pd.Series):
                raise CheckFailed(prefix + "Ожидался столбец (Series), а получено %s." % _type_name(actual))
            a, e = actual, expected
            if is_df:
                ac, ec = [str(c) for c in a.columns], [str(c) for c in e.columns]
                missing = [c for c in ec if c not in ac]
                extra = [c for c in ac if c not in ec]
                if a.shape != e.shape and not (missing or extra):
                    raise CheckFailed(prefix + "Размер таблицы %s, а должен быть %s (строки, колонки)."
                                      % (a.shape, e.shape))
                if missing or extra:
                    parts = []
                    if missing:
                        parts.append("не хватает колонок %s" % missing)
                    if extra:
                        parts.append("лишние колонки %s" % extra)
                    text = "; ".join(parts)
                    raise CheckFailed(prefix + text[:1].upper() + text[1:] + ".")
                if ac != ec:
                    if check_like:
                        a = a[list(e.columns)]
                    else:
                        raise CheckFailed(prefix + "Порядок колонок другой: у вас %s, нужно %s." % (ac, ec))
            elif len(a) != len(e):
                raise CheckFailed(prefix + "Длина столбца %d, а должна быть %d." % (len(a), len(e)))
            if check_index:
                if not a.index.equals(e.index):
                    ai, ei = list(a.index), list(e.index)
                    pos = next((i for i, (x, y) in enumerate(zip(ai, ei)) if x != y), None)
                    detail = ""
                    if pos is not None:
                        detail = " Позиция %d: у вас метка %r, нужна %r." % (pos, ai[pos], ei[pos])
                    raise CheckFailed(prefix + "Метки строк (индекс) не совпадают." + detail +
                                      " Проверьте порядок строк и нужен ли `reset_index(drop=True)`.")
            else:
                a = a.reset_index(drop=True)
                e = e.reset_index(drop=True)
            cols = list(e.columns) if is_df else [None]
            for c in cols:
                av = a[c] if is_df else a
                ev = e[c] if is_df else e
                if pd.api.types.is_numeric_dtype(ev) and pd.api.types.is_numeric_dtype(av):
                    an = av.to_numpy(dtype=float, na_value=np.nan)
                    en = ev.to_numpy(dtype=float, na_value=np.nan)
                    bad = ~np.isclose(an, en, rtol=rtol, atol=atol, equal_nan=True)
                else:
                    an = av.astype(object).to_numpy()
                    en = ev.astype(object).to_numpy()
                    bad = np.array([not (_both_missing(x, y) or _eq(x, y)) for x, y in zip(an, en)], dtype=bool)
                if bad.any():
                    i = int(np.argmax(bad))
                    label = a.index[i] if check_index else i
                    where = "в колонке `%s`" % c if is_df else "в столбце"
                    raise CheckFailed(prefix + "Значения %s отличаются: строка %r — у вас %s, нужно %s "
                                      "(всего расхождений: %d)." % (where, label, _fmt(an[i]), _fmt(en[i]), int(bad.sum())))
                if check_dtype and str(av.dtype) != str(ev.dtype):
                    where = "колонки `%s`" % c if is_df else "столбца"
                    raise CheckFailed(prefix + "Тип %s: у вас %s, нужен %s." % (where, av.dtype, ev.dtype))

        def out_text():
            return chk.student_stdout

        def figures():
            return list(_captured_figures) + [
                f for f in _open_figures() if f not in _captured_figures]

        def axes():
            figs = figures()
            if not figs:
                raise CheckFailed("Не найдено ни одного графика. Постройте график (например, `plt.hist(...)` или `ax.bar(...)`).")
            fig = figs[-1]
            if not fig.axes:
                raise CheckFailed("На фигуре нет осей с графиком.")
            return fig.axes[0]

        def plot_axes(fig=None):
            """Все оси с графиками на последней фигуре (без шкал цвета colorbar)."""
            if fig is None:
                figs = figures()
                if not figs:
                    raise CheckFailed("Не найдено ни одного графика. Постройте график и покажите его: `plt.show()`.")
                fig = figs[-1]
            return [a for a in fig.axes if a.get_label() != "<colorbar>"]

        def pfig(name="fig"):
            """Фигура plotly ученика: последняя показанная (`fig.show()`) или переменная `fig`."""
            if _captured_plotly:
                return _captured_plotly[-1]
            v = chk.student_ns.get(name)
            if v is not None and (type(v).__module__ or "").startswith("plotly") and hasattr(v, "to_json"):
                return v
            raise CheckFailed("Не найден график plotly. Постройте его, например `fig = px.scatter(...)`, "
                              "и покажите: `fig.show()`.")

        def source():
            return chk.code

        def no_loops(msg=None):
            try:
                tree = ast.parse(chk.code)
            except SyntaxError:
                return
            for node in ast.walk(tree):
                if isinstance(node, (ast.For, ast.While, ast.ListComp, ast.GeneratorExp, ast.DictComp, ast.SetComp)):
                    raise CheckFailed(msg or "Решите задачу без цикла: примените операцию сразу ко всему массиву (векторизация).")

        def calls(name):
            """Есть ли в коде ученика вызов функции/метода с таким именем (например, 'median' или 'np.median')."""
            try:
                tree = ast.parse(chk.code)
            except SyntaxError:
                return False
            for node in ast.walk(tree):
                if isinstance(node, ast.Call):
                    f = node.func
                    full = _attr_name(f)
                    if full == name or full.endswith("." + name) or (isinstance(f, ast.Attribute) and f.attr == name):
                        return True
            return False

        return {
            "fail": fail, "ensure": ensure, "var": var, "has": has, "ref": ref, "alt": alt, "alt_ref": alt_ref,
            "close": close, "equal": equal, "same_array": same_array, "same_frame": same_frame,
            "out_text": out_text, "figures": figures, "axes": axes, "plot_axes": plot_axes, "pfig": pfig,
            "source": source, "no_loops": no_loops,
            "calls": calls, "HARDCODE_MSG": HARDCODE_MSG, "CheckFailed": CheckFailed,
            "student": chk.student_ns,
        }

    def run(self):
        out = Output()
        result = {"passed": False, "message": "", "outputs": out.items, "error": None, "kind": None}
        del _captured_figures[:]
        del _captured_plotly[:]
        _close_all_figures()
        _stage_files(self.files)
        # 1. код ученика
        try:
            self.student_ns = self._run_program(self.code, STUDENT_FILE, WORK_DIR, out)
        except BaseException as e:
            info = explain_error(e, getattr(self, "_partial_ns", None))
            result["error"] = info
            result["kind"] = "error"
            where = "в подготовке" if info.get("where") == PRELUDE_FILE else "в вашем коде"
            line = " (строка %s)" % info["line"] if info.get("line") and info.get("where") != PRELUDE_FILE else ""
            result["message"] = "Код завершился с ошибкой %s%s: %s." % (where, line, info["title"])
            _flush_figures(out)
            return result
        # фигуры ученика сохраняем как картинки и убираем из pyplot (объекты остаются для тестов графиков)
        _flush_figures(out, close=True)
        self.student_stdout = "".join(i["text"] for i in out.items if i["type"] == "text" and i["stream"] == "stdout")
        # 2. тесты
        tests = self.p.get("tests") or ""
        env = dict(self.helpers())
        env["__builtins__"] = builtins
        try:
            _register_source(TEST_FILE, tests)
            with _capture(Output(enabled=False)), _cwd(WORK_DIR):
                exec(compile(tests, TEST_FILE, "exec"), env)
            result["passed"] = True
            result["kind"] = "passed"
            result["message"] = "Все проверки пройдены!"
        except CheckFailed as e:
            result["kind"] = "failed"
            result["message"] = str(e)
        except RuntimeError as e:
            result["kind"] = "internal"
            result["message"] = "Внутренняя ошибка проверки: %s" % e
        except BaseException as e:
            info = explain_error(e, self.student_ns)
            result["kind"] = "failed"
            if "ellipsis" in str(e).lower():
                # функция из заготовки ещё возвращает `...` — проверка споткнулась о многоточие
                result["message"] = ("В решении осталось многоточие `...` из заготовки — например, в том, что возвращает "
                                     "ваша функция. Замените его на вычисление.")
            else:
                result["message"] = ("Проверка не смогла обработать ваш результат (%s: %s). "
                                     "Убедитесь, что переменные имеют нужный тип и форму." % (info["type"], info["message"][:200]))
        finally:
            _flush_figures(out)
            _close_all_figures()
        return result


def _both_missing(x, y):
    def miss(v):
        try:
            return v is None or (isinstance(v, float) and math.isnan(v)) or type(v).__name__ in ("NAType", "NaTType")
        except Exception:
            return False
    return miss(x) and miss(y)


def _eq(x, y):
    try:
        return bool(x == y)
    except Exception:
        return False


def _attr_name(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = _attr_name(node.value)
        return (base + "." if base else "") + node.attr
    return ""


def _is_number(v):
    if isinstance(v, bool):
        return False
    if isinstance(v, (int, float)):
        return True
    tn = type(v).__name__
    if tn.startswith(("float", "int", "uint")) and hasattr(v, "dtype"):
        return True
    if tn == "ndarray" and getattr(v, "shape", None) == ():
        return True
    return False


def _is_int(v):
    if isinstance(v, bool):
        return False
    if isinstance(v, int):
        return True
    tn = type(v).__name__
    return tn.startswith(("int", "uint")) and hasattr(v, "dtype")


def _open_figures():
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is None:
        return []
    return [plt.figure(n) for n in plt.get_fignums()]


def _close_all_figures():
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is not None:
        plt.close("all")


def check(payload):
    try:
        return TaskCheck(payload).run()
    except BaseException as e:  # pragma: no cover
        return {"passed": False, "kind": "internal", "message": "Внутренняя ошибка проверки: %r" % e,
                "outputs": [], "error": None}


# ---------------------------------------------------------------------------
# Точка входа для JS
# ---------------------------------------------------------------------------
def _json_default(o):
    try:
        import numpy as np
        if isinstance(o, np.generic):
            return o.item()
    except Exception:
        pass
    return str(o)


def handle(payload_json):
    global STRICT_WARNINGS
    payload = json.loads(payload_json)
    STRICT_WARNINGS = bool(payload.get("strict"))
    mode = payload.get("mode")
    if mode == "run":
        res = run(payload)
    elif mode == "check":
        res = check(payload)
    elif mode == "submission":
        res = submission(payload)
    elif mode == "reset":
        _namespaces.pop(payload.get("ns") or "default", None)
        res = {"ok": True}
    else:
        res = {"ok": False, "error": {"title": "Неизвестный режим", "message": str(mode)}}
    return json.dumps(res, ensure_ascii=False, default=_json_default)


def init():
    os.makedirs(WORK_DIR, exist_ok=True)
    os.makedirs(VARIANT_ROOT, exist_ok=True)
    _install_ipython_shim()
    os.chdir(WORK_DIR)
    if WORK_DIR not in sys.path:
        sys.path.insert(0, WORK_DIR)
    return "ok"
