# -*- coding: utf-8 -*-
"""Корпус текстов для урока 9.1 («Языковая модель»): проза уроков модулей 0–8 этого курса.

Берём только связный текст: без служебной шапки, кода, квизов, таблиц, формул и картинок. Каждый абзац — строка.
Снимок сделан один раз (16 ноября 2026), чтобы числа в уроке не менялись при правке других уроков.
Запуск: python3 scripts/data/build_course_corpus.py
"""
import glob
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
paragraphs = []
for f in sorted(glob.glob(str(ROOT / "content/m0[0-8]*/l*/lesson.md"))):
    t = Path(f).read_text(encoding="utf-8")
    t = re.sub(r"^---.*?\n---\n", "", t, flags=re.S)
    t = re.sub(r"```.*?```", "\n", t, flags=re.S)
    t = re.sub(r"\$\$.*?\$\$", "\n", t, flags=re.S)
    for block in re.split(r"\n\s*\n", t):
        lines = [ln.strip() for ln in block.splitlines()]
        lines = [ln for ln in lines if ln and not ln.startswith(("#", "|", ":::", "!["))]
        text = " ".join(lines)
        text = re.sub(r"^[-*]\s+|^\d+\.\s+", "", text)
        text = re.sub(r"\s[-*]\s+", " ", text)
        text = re.sub(r"\$[^$]+\$", " ", text)
        text = re.sub(r"`[^`]*`", " ", text)
        text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
        text = re.sub(r"[*_]{1,2}([^*_]+)[*_]{1,2}", r"\1", text)
        text = re.sub(r"\s+", " ", text).strip()
        if len(re.findall(r"[а-яё]+", text.lower())) >= 5:
            paragraphs.append(text)
out = ROOT / "public/data/course_texts.txt"
out.write_text("\n".join(paragraphs) + "\n", encoding="utf-8")
print("абзацев:", len(paragraphs), "| символов:", sum(map(len, paragraphs)))
