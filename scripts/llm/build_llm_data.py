# -*- coding: utf-8 -*-
"""Данные модуля 10 «Работа с LLM: промпт-инжиниринг».

В браузере настоящий GigaChat недоступен: для запроса нужен ключ авторизации, а ключи нельзя хранить в коде сайта.
Поэтому модуль опирается на настоящие данные из материалов курса:

  • gigachat_notebook.json — ответы GigaChat, сохранённые в Workshops/10_PromptEng.ipynb, вместе с запросами,
    которые их вызвали (восстановлены по коду ноутбука). Учебная версия библиотеки gigachat воспроизводит их;
  • qa_train.csv, qa_test.csv — вопросы с вариантами ответа из соревнования «QA» (Workshops/basic competitions);
  • qa_gigachat_baseline.csv — номера ответов, которые базовое решение ноутбука Baseline_hw3.ipynb получило
    от GigaChat на проверочных вопросах (первое число в тексте ответа модели).
  • recording.wav и voice_bot_notebook.json — модуль 11: запись голоса из ноутбука голосового бота
    (Workshops/2025/08_Голосовой_бот_Colab.ipynb), ответы SaluteSpeech на распознавание, напечатанные в нём, и диалог
    голосового чата с GigaChat (история AudioChat.history) — его воспроизводит учебная версия langchain_gigachat.

Запуск: python3 scripts/llm/build_llm_data.py  (путь к материалам курса — переменная COURSE_MATERIALS)
"""
import csv
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "data"
# материалы курса (распакованный архив репозитория курса); путь можно задать переменной COURSE_MATERIALS
MATERIALS = Path(os.environ.get("COURSE_MATERIALS", Path.home() / "Downloads" / "BasicDataAnalysisCourse-main"))
SRC = MATERIALS / "Workshops"
COMP = SRC / "basic competitions"

MESSAGE = "Дай определение и Расскажи в 3 коротких пунктах об особенностях prompt engineering, "
SYSTEM = (
    "Ты полезный ассистент для тестирования ГигаЧата. Твоя задача отвечать студенту на учебные вопросы\n"
    "## Инструкция\n"
    "Ответ должен подходить студенту начальных курсов бакалавриата, изучающему технологии искусственного интеллекта\n"
    "## Формат ответа\n"
    "Текст и таблицы в формате markdown\n"
)
LC_SYSTEM = "Отвечай как инженр-датасаинтист с 20 летним опытом. Используй Markdown разметку ответа. Ответ не должен быть длинее 10 строк"
LC_QUESTION = "Какие приемущества может дать langchain в работе с GigaChat"
COT = """
Реши задачу шаг за шагом:

Задача: {problem}

Пожалуйста:
1. Сначала пойми, что дано и что нужно найти
2. Разбей решение на логические шаги
3. Выполни вычисления для каждого шага
4. Проверь правильность рассуждений
5. Сформулируй окончательный ответ

"""
PROBLEMS = [
    "В классе 30 учеников. 40% из них - девочки. Сколько мальчиков в классе?",
    "Книга стоит 500 рублей. После скидки цена снизилась на 20%. Сколько стоит книга после скидки?",
]


def notebook_outputs():
    nb = json.load(open(SRC / "10_PromptEng.ipynb", encoding="utf-8"))

    def printed(i):
        return "".join("".join(o.get("text", "")) for o in nb["cells"][i].get("outputs", []) if o.get("name") == "stdout")

    def markdown(i, k=0):
        outs = [o for o in nb["cells"][i].get("outputs", []) if "text/markdown" in o.get("data", {})]
        text = "".join(outs[k]["data"]["text/markdown"])
        return text.replace("<blockquote>\n\n", "", 1)

    def cot(k):
        text = markdown(63, 2 * k + 1)
        return text.replace("**Решение:\n\n** ", "", 1)

    u = lambda c: {"role": "user", "content": c}  # noqa: E731
    return [
        {"id": "definition-1", "cell": 9, "model": "GigaChat", "messages": [u(MESSAGE)],
         "response": printed(9).rstrip("\n"), "finish_reason": None,
         "note": "Первый вопрос ноутбука: модель по умолчанию, параметры по умолчанию."},
        {"id": "definition-2", "cell": 14, "model": "GigaChat", "messages": [u(MESSAGE)],
         "response": markdown(14), "finish_reason": None,
         "note": "Тот же запрос ещё раз — ответ другой."},
        {"id": "definition-pro-1", "cell": 16, "model": "GigaChat-2-Pro", "messages": [u(MESSAGE)],
         "response": markdown(16), "finish_reason": None, "note": "Тот же вопрос другой модели."},
        {"id": "definition-pro-2", "cell": 22, "model": "GigaChat-2-Pro", "messages": [u(MESSAGE)],
         "response": markdown(22), "finish_reason": None,
         "note": "В ноутбуке собран payload с temperature=0.7 и max_tokens=100, но в chat передана строка MESSAGE — "
                 "параметры не дошли до модели, и ответ полной длины."},
        {"id": "system-100", "cell": 25, "model": "GigaChat-2-Pro",
         "messages": [{"role": "system", "content": SYSTEM}, u(MESSAGE)], "temperature": 0.7, "max_tokens": 100,
         "response": markdown(25), "finish_reason": "length",
         "note": "Системный промпт и max_tokens=100: ответ оборван на втором из трёх пунктов. finish_reason в ноутбуке "
                 "не напечатан; обрыв ответа означает 'length' — модель упёрлась в max_tokens."},
        {"id": "history-100", "cell": 27, "model": "GigaChat-2-Pro",
         "messages": [{"role": "system", "content": SYSTEM}, u(MESSAGE), u(markdown(25)),
                      u("Уточни контент определением ролей")], "temperature": 0.7, "max_tokens": 100,
         "response": markdown(27), "finish_reason": "length",
         "note": "Ответ модели добавлен в историю с ролью user, а не assistant; max_tokens=100 снова обрывает ответ."},
        {"id": "search-final", "cell": 39, "model": "GigaChat-2-Pro", "messages": None,
         "response": markdown(39), "finish_reason": "stop",
         "note": "Финальный ответ после вызова функции поиска duckduckgo_search; аргументы вызова и результаты поиска "
                 "в ноутбуке не сохранились."},
        {"id": "calc-final", "cell": 47, "model": "GigaChat-2-Pro", "messages": None,
         "response": markdown(47), "finish_reason": "stop",
         "note": "Финальный ответ после вызова функции calculate."},
        {"id": "langchain-advantages", "cell": 59, "model": "GigaChat-Pro",
         "messages": [{"role": "system", "content": LC_SYSTEM}, u(LC_QUESTION)],
         "response": markdown(59), "finish_reason": None,
         "note": "Через langchain_gigachat; в ноутбуке ответ обрезан кодом до 600 символов."},
        {"id": "langchain-example", "cell": 61, "model": "GigaChat-Pro", "messages": None,
         "response": markdown(61), "finish_reason": None,
         "note": "Ответ на просьбу привести пример цепочки с langchain_gigachat: модель выдумала подключение GigaChat "
                 "через HuggingFaceHub с repo_id='gigachat' — такой модели и такого способа нет."},
        {"id": "cot-1", "cell": 63, "model": "GigaChat-Pro", "messages": [u(COT.format(problem=PROBLEMS[0]))],
         "response": cot(0), "finish_reason": None, "note": "Цепочка рассуждений (chain of thought)."},
        {"id": "cot-2", "cell": 63, "model": "GigaChat-Pro", "messages": [u(COT.format(problem=PROBLEMS[1]))],
         "response": cot(1), "finish_reason": None, "note": "Цепочка рассуждений (chain of thought)."},
    ]


def voice_records():
    """Ответы SaluteSpeech на распознавание речи, напечатанные в ноутбуке голосового бота («Весь ответ API: {...}»)."""
    import ast
    import re
    nb = json.load(open(SRC / "2025" / "08_Голосовой_бот_Colab.ipynb", encoding="utf-8"))
    notes = {31: "Распознавание записи recording.wav функцией stt.",
             46: "Первый вопрос голосового чата AudioChat.process_audio.",
             48: "Второй вопрос голосового чата.",
             62: "Распознавание в голосовом чате на Gradio."}
    out = []
    for cell, note in notes.items():
        text = "".join("".join(o.get("text", "")) for o in nb["cells"][cell].get("outputs", []))
        for m in re.finditer(r"Весь ответ API: (\{.*?\})\n", text):
            out.append({"kind": "stt", "cell": cell, "note": note, "response": ast.literal_eval(m.group(1))})
    return out + voice_dialog_records(nb)


def voice_dialog_records(nb):
    """Диалог голосового чата с GigaChat: история AudioChat.history, напечатанная в ячейке 52.

    Каждый ответ модели — запись с запросом, который его вызвал: вся история до него (AudioChat отправляет её целиком).
    Учебная версия langchain_gigachat воспроизводит эти ответы для тех же сообщений.
    """
    import ast
    import re
    text = "".join("".join(o["data"].get("text/plain", "")) for o in nb["cells"][52]["outputs"] if "data" in o)
    pattern = r"(HumanMessage|AIMessage)\(content=('(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\")"
    history = [("user" if kind == "HumanMessage" else "assistant", ast.literal_eval(lit))
               for kind, lit in re.findall(pattern, text)]
    assert [r for r, _ in history] == ["user", "assistant"] * 3, history
    last = "".join("".join(o["data"].get("text/plain", "")) for o in nb["cells"][50]["outputs"] if "data" in o)
    assert ast.literal_eval(last) == history[-1][1], "ответ в ячейке 50 должен совпасть с концом истории"
    notes = ["Ответ на распознанный первый вопрос голосового чата («Проверим.»).",
             "Ответ на второй вопрос голосового чата: модель видит всю историю.",
             "Текстовый вопрос conversation_predict('привет, как дела') в том же чате."]
    out = []
    for k in range(3):
        before = history[: 2 * k + 1]
        out.append({"kind": "gigachat", "id": "voice-chat-%d" % (k + 1), "cell": 52, "model": "GigaChat",
                    "messages": [{"role": r, "content": c} for r, c in before],
                    "response": history[2 * k + 1][1], "finish_reason": None, "note": notes[k]})
    return out


def fix_latex_options(value):
    """Список вариантов в одинарных кавычках с формулой LaTeX → корректный JSON.

    В вопросе 439 теста варианты записаны как список Python: ['$x + C$', '1', '$\\frac{x^2}{2} + C$', '0'].
    При разборе ast.literal_eval «\\f» в «\\frac» становится управляющим символом (перевод страницы), и формула
    портится. Здесь обратные косые черты удваиваются до разбора, а список сохраняется как JSON — формула остаётся
    целой. Строки, которые и так JSON или не разбираются вовсе (апостроф внутри кавычек), не меняются.
    """
    import ast
    import warnings
    s = value.strip()
    if "\\" not in s:
        return value
    try:
        json.loads(s.rstrip(",").strip())
        return value
    except json.JSONDecodeError:
        pass
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            parsed = ast.literal_eval(s.replace("\\", "\\\\"))
            plain = ast.literal_eval(s)
        except (ValueError, SyntaxError):
            return value
    # переписываем, только если обычный разбор портит текст («\\pi» он оставляет как есть, «\\f» — портит)
    if not isinstance(parsed, (list, tuple)) or list(parsed) == list(plain):
        return value
    return json.dumps([str(x) for x in parsed], ensure_ascii=False)


def copy_csv(src, dst, keep=None):
    rows = list(csv.DictReader(open(src, encoding="utf-8-sig")))
    cols = keep or list(rows[0].keys())
    fixed = []
    with open(dst, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        for r in rows:
            row = {c: r[c] for c in cols}
            if "id" in row:
                row["id"] = str(int(float(row["id"])))
            if "варианты" in row:
                new = fix_latex_options(row["варианты"])
                if new != row["варианты"]:
                    fixed.append(row.get("id"))
                    row["варианты"] = new
            w.writerow(row)
    if fixed:
        print(f"{dst.name}: варианты с формулами переписаны в JSON у вопросов {fixed}")
    return len(rows)


if __name__ == "__main__":
    data = notebook_outputs()
    (OUT / "gigachat_notebook.json").write_text(json.dumps({"source": "Workshops/10_PromptEng.ipynb (= Workshops/2025/06_PromptEng.ipynb)", "records": data},
                                                           ensure_ascii=False, indent=1), encoding="utf-8")
    n_train = copy_csv(COMP / "qa_train.xls", OUT / "qa_train.csv")
    n_test = copy_csv(COMP / "qa_test.xls", OUT / "qa_test.csv")
    n_pred = copy_csv(COMP / "qa_submission.csv", OUT / "qa_gigachat_baseline.csv")
    voice = voice_records()
    (OUT / "voice_bot_notebook.json").write_text(json.dumps(
        {"source": "Workshops/2025/08_Голосовой_бот_Colab.ipynb", "records": voice}, ensure_ascii=False, indent=1),
        encoding="utf-8")
    (OUT / "recording.wav").write_bytes((SRC / "recording.wav").read_bytes())
    print("записей GigaChat:", len(data), "| qa_train:", n_train, "| qa_test:", n_test, "| прогнозов baseline:", n_pred,
          "| ответов SaluteSpeech:", len(voice))
