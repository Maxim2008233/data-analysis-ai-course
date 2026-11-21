# -*- coding: utf-8 -*-
"""Модель тональности distilbert-sst2 в браузере: логиты, заранее посчитанные настоящей моделью.

Настоящие веса — 268 МБ и PyTorch — в браузер не загрузить, поэтому модель «знает» результаты только для
отзывов урока (файл sst2_logits.json). На них ответ ровно тот же, что в Colab: логиты посчитаны там же.
"""
import json

from . import _hub


class _Config:
    def __init__(self, name, id2label):
        self.name_or_path = name
        self._name_or_path = name
        self.model_type = "distilbert"
        self.id2label = {int(k): v for k, v in id2label.items()}
        self.label2id = {v: k for k, v in self.id2label.items()}
        self.num_labels = len(self.id2label)
        self.architectures = ["DistilBertForSequenceClassification"]

    def __repr__(self):
        return ("DistilBertConfig(name_or_path='%s', model_type='distilbert', num_labels=%d, id2label=%s)"
                % (self.name_or_path, self.num_labels, self.id2label))


class SequenceClassifierOutput(dict):
    """Результат модели: outputs.logits — логиты, по строке на текст."""

    def __init__(self, logits):
        super().__init__(logits=logits)
        self.logits = logits

    def __repr__(self):
        return "SequenceClassifierOutput(loss=None, logits=%r, hidden_states=None, attentions=None)" % (self.logits,)


class DistilBertForSequenceClassification:
    """Классификатор тональности: на вход input_ids и attention_mask, на выход логиты [NEGATIVE, POSITIVE]."""

    def __init__(self, name, data):
        import numpy as np
        self.name_or_path = name
        self.config = _Config(name, data["id2label"])
        self._table = {tuple(e["input_ids"]): np.array(e["logits"], dtype=np.float32) for e in data["examples"]}
        self._texts = [e["text"] for e in data["examples"]]

    def __repr__(self):
        return ("DistilBertForSequenceClassification(%s) — браузерная версия: 66 955 010 параметров не загружены, "
                "логиты посчитаны заранее для %d отзывов урока" % (self.name_or_path, len(self._texts)))

    def eval(self):
        return self

    def to(self, *args, **kwargs):
        return self

    def num_parameters(self):
        return 66955010

    def available_texts(self):
        """Тексты, для которых в браузере есть результат модели."""
        return list(self._texts)

    def __call__(self, input_ids=None, attention_mask=None, **kwargs):
        import numpy as np
        if input_ids is None:
            raise TypeError("Модели нужны input_ids — номера токенов от токенизатора: model(**inputs).")
        ids = np.asarray(input_ids)
        if ids.ndim == 1:
            ids = ids[None, :]
        if ids.ndim != 2:
            raise ValueError("input_ids должны быть таблицей «тексты × токены», а форма %s." % (ids.shape,))
        mask = np.ones_like(ids) if attention_mask is None else np.asarray(attention_mask)
        if mask.ndim == 1:
            mask = mask[None, :]
        if mask.shape != ids.shape:
            raise ValueError("attention_mask должна быть той же формы, что input_ids: %s и %s." % (mask.shape, ids.shape))
        rows = []
        for r, m in zip(ids, mask):
            key = tuple(int(i) for i, keep in zip(r, m) if keep)
            if key not in self._table:
                hint = ""
                if attention_mask is None and 0 in key:   # 0 — номер токена [PAD]
                    hint = (" Похоже, в последовательности есть токены [PAD], а attention_mask не передана: "
                            "без неё модель «смотрит» и на заполнение — передайте всё, что вернул токенизатор: model(**inputs).")
                raise _hub.BrowserLimitation(
                    "Для этой последовательности токенов в браузере нет результата модели: настоящие веса не загружены, "
                    "логиты посчитаны заранее только для отзывов урока (model.available_texts())." + hint +
                    " На своих текстах модель можно запустить в Colab: " + _hub.COLAB)
            rows.append(self._table[key])
        return SequenceClassifierOutput(logits=np.stack(rows))


def load_sequence_classifier(name):
    files = _hub.MODELS[name]
    if "logits" not in files:
        raise _hub.BrowserLimitation("Модель %s — не классификатор текста." % name)
    with open(_hub.data_file(files["logits"]), encoding="utf-8") as fh:
        return DistilBertForSequenceClassification(name, json.load(fh))
