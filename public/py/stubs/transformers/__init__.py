# -*- coding: utf-8 -*-
"""Браузерная (учебная) версия библиотеки transformers для курса.

Настоящая transformers работает на PyTorch, а его в браузере нет. Здесь тот же интерфейс:

  • AutoTokenizer — настоящий токенизатор WordPiece со словарём distilbert-base-uncased: работает на любом тексте;
  • AutoModelForSequenceClassification — модель тональности distilbert-sst2: логиты посчитаны заранее настоящей
    моделью для отзывов урока;
  • pipeline — 'sentiment-analysis' / 'text-classification' и 'zero-shot-image-classification' (CLIP ViT-B/32:
    эмбеддинги картинок и подписей посчитаны заранее, сравнение выполняется здесь).

Всё остальное — в Colab с настоящей библиотекой: ноутбук курса Workshops/09_HF_intro.ipynb.
"""
from . import _hub
from .pipelines import pipeline

__version__ = "browser"
__all__ = ["AutoTokenizer", "AutoModelForSequenceClassification", "pipeline"]


class AutoTokenizer:
    """AutoTokenizer.from_pretrained(имя) — токенизатор модели по её имени на Hugging Face."""

    @staticmethod
    def from_pretrained(name, **kwargs):
        from .tokenization_bert import load_bert_tokenizer
        full = _hub.resolve(name)
        if full != _hub.SST2:
            raise _hub.BrowserLimitation(
                "В браузере есть токенизатор только для %s. Токенизаторы других моделей — в Colab: %s" % (_hub.SST2, _hub.COLAB))
        return load_bert_tokenizer(full)


class AutoModelForSequenceClassification:
    """AutoModelForSequenceClassification.from_pretrained(имя) — модель с «головой» для классификации текста."""

    @staticmethod
    def from_pretrained(name, **kwargs):
        from .modeling import load_sequence_classifier
        full = _hub.resolve(name)
        if full != _hub.SST2:
            raise _hub.BrowserLimitation(
                "В браузере есть только модель тональности %s. Другие модели — в Colab: %s" % (_hub.SST2, _hub.COLAB))
        return load_sequence_classifier(full)


def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    raise _hub.BrowserLimitation(
        "В браузерной версии transformers нет «%s». Здесь есть: AutoTokenizer, AutoModelForSequenceClassification и "
        "pipeline. Всё остальное — в Colab с настоящей библиотекой: %s" % (name, _hub.COLAB))
