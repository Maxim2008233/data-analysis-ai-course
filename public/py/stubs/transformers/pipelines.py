# -*- coding: utf-8 -*-
"""pipeline() в браузере: тональность текста (distilbert-sst2) и zero-shot классификация картинок (CLIP).

Внутри — тот же путь, что у настоящего pipeline: токенизатор → модель → softmax → метка.
Для CLIP: эмбеддинг картинки и эмбеддинги подписей посчитаны заранее настоящей моделью,
а сравнение (косинусное сходство × 100 → softmax) выполняется здесь, как в transformers.
"""
from . import _hub


def _softmax(x):
    import numpy as np
    z = np.asarray(x, dtype=np.float64)
    z = z - z.max(axis=-1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=-1, keepdims=True)


class TextClassificationPipeline:
    task = "text-classification"

    def __init__(self, model_name):
        from .modeling import load_sequence_classifier
        from .tokenization_bert import load_bert_tokenizer
        self.model = load_sequence_classifier(model_name)
        self.tokenizer = load_bert_tokenizer(model_name)

    def __repr__(self):
        return "TextClassificationPipeline(model='%s') — браузерная версия" % self.model.name_or_path

    def __call__(self, inputs, top_k=1, **kwargs):
        single = isinstance(inputs, str)
        texts = [inputs] if single else list(inputs)
        enc = self.tokenizer(texts, padding=True, truncation=True, return_tensors="np")
        probs = _softmax(self.model(**enc).logits)
        id2label = self.model.config.id2label
        results = []
        for p in probs:
            order = p.argsort()[::-1]
            ranked = [{"label": id2label[int(i)], "score": float(p[i])} for i in order]
            results.append(ranked[0] if top_k == 1 else ranked[: (len(ranked) if top_k is None else top_k)])
        return results


class ZeroShotImageClassificationPipeline:
    task = "zero-shot-image-classification"
    logit_scale = 100.0

    def __init__(self, model_name):
        import csv
        import numpy as np
        files = _hub.MODELS[model_name]
        self.model_name = model_name
        import os
        with open(_hub.data_file(files["images"]), encoding="utf-8") as fh:
            self._image_ids = [r["ID"] for r in csv.DictReader(fh)]
        embs = [np.load(_hub.data_file(files["image_emb"])).astype(np.float32)]
        for table, emb in files.get("extra_images", []):
            if os.path.exists(table) and os.path.exists(emb):
                with open(table, encoding="utf-8") as fh:
                    self._image_ids += [r["ID"] for r in csv.DictReader(fh)]
                embs.append(np.load(emb).astype(np.float32))
        self._image_emb = np.concatenate(embs)
        self._image_index = {i: n for n, i in enumerate(self._image_ids)}
        with np.load(_hub.data_file(files["prompts"])) as data:
            prompts = [str(p) for p in data["prompt"]]
            self._text_emb = data["emb"].astype(np.float32)
        self._prompt_index = {}
        for n, p in enumerate(prompts):
            self._prompt_index.setdefault(p, n)

    def __repr__(self):
        return "ZeroShotImageClassificationPipeline(model='%s') — браузерная версия" % self.model_name

    def _image(self, image):
        key = str(image).split("/")[-1]
        if key not in self._image_index:
            raise _hub.BrowserLimitation(
                "Картинки «%s» нет среди картинок урока. В браузере CLIP не видит пикселей — эмбеддинги посчитаны "
                "заранее для %d картинок из zs_public.csv и проверочной таблицы соревнования (передавайте ID, например '%s'). "
                "Свои картинки — в Colab: %s"
                % (image, len(self._image_ids), self._image_ids[0], _hub.COLAB))
        return self._image_emb[self._image_index[key]]

    def _text(self, prompt):
        if prompt not in self._prompt_index:
            raise _hub.BrowserLimitation(
                "Для подписи «%s» нет эмбеддинга: текстовая часть CLIP в браузере не работает, поэтому доступны только "
                "подписи из zs_prompts.npz (по 10 вариантов на каждый класс). Свои подписи можно проверить в Colab: %s"
                % (prompt, _hub.COLAB))
        return self._text_emb[self._prompt_index[prompt]]

    def __call__(self, image, candidate_labels=None, hypothesis_template="This is a photo of {}.", **kwargs):
        import numpy as np
        if not candidate_labels:
            raise ValueError("Укажите candidate_labels — список подписей-кандидатов.")
        single = isinstance(image, str)
        images = [image] if single else list(image)
        texts = np.stack([self._text(hypothesis_template.format(lab)) for lab in candidate_labels])
        results = []
        for img in images:
            probs = _softmax(self.logit_scale * texts @ self._image(img))
            order = probs.argsort()[::-1]
            results.append([{"score": float(probs[i]), "label": candidate_labels[i]} for i in order])
        return results[0] if single else results


def pipeline(task=None, model=None, **kwargs):
    """Как transformers.pipeline: pipeline('sentiment-analysis') или pipeline('zero-shot-image-classification')."""
    if task is None:
        raise ValueError("Укажите задачу, например pipeline('sentiment-analysis').")
    if task not in _hub.DEFAULT_MODEL:
        raise _hub.BrowserLimitation(
            "Задача «%s» в браузерной версии недоступна. Здесь работают: sentiment-analysis, text-classification и "
            "zero-shot-image-classification. Остальные задачи (question-answering, text-generation, summarization…) "
            "запустите в Colab: %s" % (task, _hub.COLAB))
    name = _hub.resolve(model) if model is not None else _hub.DEFAULT_MODEL[task]
    if task == "zero-shot-image-classification":
        if name != _hub.CLIP:
            raise _hub.BrowserLimitation("Для zero-shot классификации картинок в браузере есть только %s." % _hub.CLIP)
        return ZeroShotImageClassificationPipeline(name)
    if name != _hub.SST2:
        raise _hub.BrowserLimitation("Для классификации текста в браузере есть только %s." % _hub.SST2)
    return TextClassificationPipeline(name)
