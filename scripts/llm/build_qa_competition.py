# -*- coding: utf-8 -*-
"""Соревнование 3 «Тест с вариантами ответа»: скрытые ответы из разметки.

Правильных ответов теста QA в материалах курса нет (ноутбук базового решения читает их из test_with_answers.csv,
который есть только у преподавателя). Поэтому ответы разметили составители сайта; разметка с уверенностью и
комментариями — в private/competitions/qa/разметка_теста_QA_на_проверку.csv, проверенная версия —
разметка_теста_QA_проверено.csv (её и читает скрипт). Столбец «Исправление» заполняет проверяющий: номер варианта
заменяет ответ, «не оценивать» исключает вопрос.

Не оцениваются:
  • вопросы о событиях 2025–2026 годов — их нельзя надёжно проверить (даже если проверяющий вписал номер);
  • испорченные вопросы: вместо вариантов текст вопроса, вопрос и варианты перепутаны, позиция в шахматной задаче
    не даёт мата, задача на матрицу Равена без картинки. Номер, который проверяющий вписал к такому вопросу как
    «Догадка» о ключе, не оценивается (решение от 17.11.2026); номер без пометки «Догадка» возвращает вопрос в подсчёт
    (так оцениваются вопросы 333 и 392: варианты-формулы не разбираются программой, но читаются).

Результат:
  private/competitions/qa/answers.json — {"ids": все ID теста, "scored": оцениваемые ID, "answers": ответы на них}.
  Печатает долю верных у базового решения (прогнозы qa_gigachat_baseline.csv) — это baseline в реестре.

Запуск: python3 scripts/llm/build_qa_competition.py
"""
import csv
import io
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PRIVATE = ROOT / "private" / "competitions" / "qa"
REVIEW = PRIVATE / "разметка_теста_QA_проверено.csv"
DATA = ROOT / "public" / "data"


def read_review(path):
    """Таблицу могли пересохранить в Excel: другая кодировка и разделитель — пробуем варианты."""
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "cp1251", "mac_cyrillic"):
        try:
            text = raw.decode(enc)
        except UnicodeDecodeError:
            continue
        delimiter = ";" if text.split("\n", 1)[0].count(";") >= text.split("\n", 1)[0].count(",") else ","
        rows = list(csv.DictReader(io.StringIO(text), delimiter=delimiter))
        if rows and "№" in rows[0]:
            return rows
    raise SystemExit("Не удалось прочитать таблицу разметки: " + str(path))


def final_answer(row):
    """(ответ, оценивается ли) с учётом столбца «Исправление»."""
    fix = (row.get("Исправление") or "").strip().lower()
    mine = row["Мой ответ"].strip()
    scored = row["Оценивается"].strip() == "да"
    news = row["Оценивается"].startswith("нет — новости")
    broken = row["Оценивается"].startswith("нет — вопрос испорчен")
    guess = (row.get("Ваш комментарий") or "").strip().lower().startswith("догадка")
    if fix:
        if fix.startswith("не оцен"):
            return None, False
        if fix.lstrip("-").isdigit():
            return int(fix), not news and not (broken and guess)
        raise SystemExit(f"Вопрос {row['№']}: непонятное исправление «{row['Исправление']}» — нужен номер варианта или «не оценивать»")
    if not mine.lstrip("-").isdigit():
        return None, False
    return int(mine), scored


if __name__ == "__main__":
    rows = read_review(REVIEW)
    test_ids = [int(r["id"]) for r in csv.DictReader(open(DATA / "qa_test.csv", encoding="utf-8"))]
    by_id = {int(r["№"]): r for r in rows}
    assert sorted(by_id) == sorted(test_ids), "в таблице разметки не те ID, что в qa_test.csv"
    scored, answers, fixes = [], [], 0
    for i in sorted(by_id):
        ans, ok = final_answer(by_id[i])
        fixes += bool((by_id[i].get("Исправление") or "").strip())
        if ok and ans is not None:
            scored.append(i)
            answers.append(ans)
    PRIVATE.mkdir(parents=True, exist_ok=True)
    (PRIVATE / "answers.json").write_text(json.dumps({"ids": sorted(test_ids), "scored": scored, "answers": answers}), encoding="utf-8")

    pred = {int(r["id"]): int(r["prediction"]) for r in csv.DictReader(open(DATA / "qa_gigachat_baseline.csv", encoding="utf-8"))}
    correct = sum(pred[i] == a for i, a in zip(scored, answers))
    print(f"вопросов: {len(test_ids)}, оцениваются: {len(scored)}, исправлений в таблице: {fixes}")
    print(f"baseline (qa_gigachat_baseline.csv): {correct} из {len(scored)} = {correct / len(scored):.4f}")
