# -*- coding: utf-8 -*-
"""Какие модели есть в браузерной версии transformers и где лежат их данные.

Настоящих весов здесь нет: PyTorch и transformers в браузере не работают. Результаты моделей один раз посчитаны
настоящей библиотекой (scripts/hf/build_hf_data.py) и лежат в файлах урока. Токенизатор при этом настоящий:
алгоритм WordPiece со словарём модели работает на любом тексте.
"""
import os

COLAB = "https://colab.research.google.com/github/MVRonkin/BasicDataAnalysisCourse/blob/main/Workshops/09_HF_intro.ipynb"

SST2 = "distilbert/distilbert-base-uncased-finetuned-sst-2-english"
CLIP = "openai/clip-vit-base-patch32"

_ALIASES = {
    "distilbert-base-uncased-finetuned-sst-2-english": SST2,
    "distilbert/distilbert-base-uncased-finetuned-sst-2-english": SST2,
    "openai/clip-vit-base-patch32": CLIP,
}

MODELS = {
    SST2: {"vocab": "distilbert_vocab.txt", "logits": "sst2_logits.json"},
    CLIP: {"images": "zs_public.csv", "image_emb": "zs_public.npy", "prompts": "zs_prompts.npz",
           # картинки соревнования 2 (если файлы подключены): ID и векторы без классов
           "extra_images": [("competition_zs_test.csv", "competition_zs_test.npy")]},
}

DEFAULT_MODEL = {"sentiment-analysis": SST2, "text-classification": SST2, "zero-shot-image-classification": CLIP}


class BrowserLimitation(RuntimeError):
    """Это действие требует настоящей библиотеки transformers — в браузере его нет."""


def resolve(name):
    key = str(name).strip()
    if key in _ALIASES:
        return _ALIASES[key]
    known = ", ".join(sorted(set(_ALIASES.values())))
    raise OSError(
        "Модель «%s» в браузерной версии transformers недоступна. Здесь есть: %s. "
        "С любой моделью с Hugging Face можно работать в Colab: %s" % (key, known, COLAB)
    )


def data_file(name):
    """Путь к файлу с данными модели в папке урока."""
    if not os.path.exists(name):
        raise FileNotFoundError(
            "Нет файла %s: браузерная версия transformers берёт результаты модели из файлов урока. "
            "Запустите код в уроке модуля 9, где этот файл подключён." % name
        )
    return name
