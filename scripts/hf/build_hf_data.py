# -*- coding: utf-8 -*-
"""Данные модуля 9: один раз прогоняем настоящие модели Hugging Face и сохраняем результаты для сайта.

В браузере (Pyodide) нет PyTorch и transformers, поэтому учебная версия transformers на сайте
(public/py/stubs/transformers) берёт результаты отсюда:

  • distilbert_vocab.txt — словарь токенизатора distilbert-base-uncased-finetuned-sst-2-english
    (сам токенизатор WordPiece работает в браузере по-настоящему, на любом тексте);
  • reviews.csv и sst2_logits.json — логиты модели тональности для набора отзывов;
  • distilbert_attention.npz — настоящие веса внимания той же модели (6 слоёв × 12 голов) для двух фраз (урок 9.3);
  • zs_public.{csv,npy}, zs_prompts.npz, zs_thumbs.npz — эмбеддинги CLIP ViT-B/32 для половины картинок соревнования
    «Zero-shot классификация изображений» (по 2 картинки каждого класса) и для промптов-подписей.
    Вторая половина картинок — скрытая проверочная часть соревнования 2: её ответы — в private/.

Запуск (окружение и модели — в .cache, в репозиторий не попадают):
  python3.10 -m venv .cache/hf-venv && .cache/hf-venv/bin/pip install torch transformers pillow
  HF_HOME=$PWD/.cache/hf .cache/hf-venv/bin/python scripts/hf/build_hf_data.py [reviews attention clip competition]
Без аргументов собираются все части. Часть competition — файлы соревнования 2 (скрытая половина картинок под новыми ID).
"""
import csv
import json
import os
import sys
import zipfile
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from transformers import AutoModelForSequenceClassification, AutoTokenizer, CLIPModel, CLIPProcessor

sys.path.insert(0, str(Path(__file__).parent))
from class_names import GROUP_HINT, clean, english  # noqa: E402
from reviews import REVIEWS  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "data"
PRIVATE = ROOT / "private" / "competitions" / "zero-shot"
CACHE = ROOT / ".cache" / "zs"
# материалы курса (распакованный архив репозитория курса); путь можно задать переменной COURSE_MATERIALS
MATERIALS = Path(os.environ.get("COURSE_MATERIALS", Path.home() / "Downloads" / "BasicDataAnalysisCourse-main"))
ZIP = MATERIALS / "Workshops" / "basic competitions" / "ZS CLF comp.zip"
SST2 = "distilbert/distilbert-base-uncased-finetuned-sst-2-english"
CLIP = "openai/clip-vit-base-patch32"
SEED = 20261116
TEMPLATES = {
    # вариант промпта → шаблон; {raw} — метка как в разметке, {clean} — без дефисов, {en} — английское название
    "raw": "{raw}",
    "pipeline": "This is a photo of {raw}.",          # шаблон по умолчанию у pipeline zero-shot-image-classification
    "clean": "{clean}",
    "en": "{en}",
    "photo": "a photo of a {en}.",
    "photo_group": "a photo of a {en}, a type of {group}.",
    "closeup": "a close-up photo of a {en}.",
    "drawing": "a drawing of a {en}.",
    "bad_photo": "a bad photo of a {en}.",
    "photo_the": "a photo of the {en}.",
}
THUMB_CLASSES = [
    "panthera-leo", "ursus-maritimus", "phoenicopterus-ruber", "flamenco", "Elefante", "loxodonta-africana",
    "bos-gaurus", "desmodus-rotundus", "cryptoprocta-ferox", "sushi", "pizza", "ramen", "tiramisu", "poutine",
    "airplanes", "umbrella", "grand_piano", "stop_sign", "BACKGROUND_Google", "Faces", "cougar", "puma-concolor",
    "Hormiga", "formicidae",
]


def save_vocab_and_reviews():
    tok = AutoTokenizer.from_pretrained(SST2)
    model = AutoModelForSequenceClassification.from_pretrained(SST2).eval()
    vocab = sorted(tok.get_vocab().items(), key=lambda kv: kv[1])
    assert [i for _, i in vocab] == list(range(len(vocab)))
    (OUT / "distilbert_vocab.txt").write_text("\n".join(t for t, _ in vocab) + "\n", encoding="utf-8")

    examples = []
    with open(OUT / "reviews.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["text", "label", "domain", "lang"])
        for text, label, domain, lang in REVIEWS:
            enc = tok(text, return_tensors="pt")
            with torch.inference_mode():
                logits = model(**enc).logits[0].tolist()
            ids = enc["input_ids"][0].tolist()
            examples.append({"text": text, "input_ids": ids, "logits": [round(v, 6) for v in logits]})
            w.writerow([text, label, domain, lang])
    data = {
        "model": SST2,
        "id2label": {str(k): v for k, v in model.config.id2label.items()},
        "max_length": tok.model_max_length,
        "examples": examples,
    }
    (OUT / "sst2_logits.json").write_text(json.dumps(data, ensure_ascii=False, indent=0), encoding="utf-8")
    print("vocab:", len(vocab), "| отзывов:", len(examples))


ATTENTION_TEXTS = [
    "The first half was brilliant, but the second half was a disaster.",
    "The food was not terrible, it was actually delicious.",
]


def save_attention():
    """Веса внимания всех 72 голов DistilBERT: tokens/attn — первая фраза, tokens2/attn2 — вторая."""
    tok = AutoTokenizer.from_pretrained(SST2)
    model = AutoModelForSequenceClassification.from_pretrained(SST2, attn_implementation="eager").eval()
    arrays = {}
    for k, text in enumerate(ATTENTION_TEXTS):
        enc = tok(text, return_tensors="pt")
        with torch.inference_mode():
            out = model(**enc, output_attentions=True)
        attn = torch.stack(out.attentions)[:, 0].numpy()          # слои × головы × токены × токены
        assert np.allclose(attn.sum(-1), 1, atol=1e-5)
        suffix = "" if k == 0 else str(k + 1)
        arrays["text" + suffix] = np.array(text)
        arrays["tokens" + suffix] = np.array(tok.convert_ids_to_tokens(enc["input_ids"][0]))
        arrays["attn" + suffix] = attn.astype(np.float32)
        print("внимание:", text, attn.shape)
    np.savez_compressed(OUT / "distilbert_attention.npz", **arrays)


def split_competition():
    rows = list(csv.DictReader(open(CACHE / "train" / "labels.csv", encoding="utf-8")))
    rows = [{"ID": r["ID"], "class": r["class"], "group": r["group"], "language": r["language"]} for r in rows]
    by_class = {}
    for r in rows:
        by_class.setdefault(r["class"], []).append(r)
    rng = np.random.default_rng(SEED)
    public, hidden = [], []
    for cls in sorted(by_class):
        items = sorted(by_class[cls], key=lambda r: int(r["ID"].split(".")[0]))
        order = rng.permutation(len(items))
        half = len(items) // 2
        public += [items[i] for i in sorted(order[:half])]
        hidden += [items[i] for i in sorted(order[half:])]
    key = lambda r: int(r["ID"].split(".")[0])  # noqa: E731
    return sorted(public, key=key), sorted(hidden, key=key)


@torch.inference_mode()
def image_features(clip, proc, ids):
    feats = []
    for start in range(0, len(ids), 32):
        imgs = [Image.open(CACHE / "train" / i).convert("RGB") for i in ids[start:start + 32]]
        out = clip.get_image_features(**proc(images=imgs, return_tensors="pt"))
        out = out.pooler_output if hasattr(out, "pooler_output") else out
        feats.append(torch.nn.functional.normalize(out, dim=-1))
    return torch.cat(feats).numpy()


@torch.inference_mode()
def text_features(clip, proc, texts):
    feats = []
    for start in range(0, len(texts), 64):
        out = clip.get_text_features(**proc(text=texts[start:start + 64], return_tensors="pt", padding=True))
        out = out.pooler_output if hasattr(out, "pooler_output") else out
        feats.append(torch.nn.functional.normalize(out, dim=-1))
    return torch.cat(feats).numpy()


def save_clip(public, hidden):
    clip = CLIPModel.from_pretrained(CLIP).eval()
    proc = CLIPProcessor.from_pretrained(CLIP)
    for part in (public, hidden):
        for r in part:
            r["english"] = english(r["class"], r["language"])

    pub_emb = image_features(clip, proc, [r["ID"] for r in public])
    hid_emb = image_features(clip, proc, [r["ID"] for r in hidden])
    with open(OUT / "zs_public.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["ID", "class", "group", "language", "english"])
        w.writeheader()
        w.writerows(public)
    np.save(OUT / "zs_public.npy", pub_emb.astype(np.float16))   # строки — как в zs_public.csv

    # промпты: по 10 вариантов на класс
    classes = {}
    for r in public + hidden:
        classes[r["class"]] = (r["group"], r["language"])
    prompt_rows = []
    for cls in sorted(classes):
        group, language = classes[cls]
        en = english(cls, language)
        hint = GROUP_HINT[group]
        for variant, tpl in TEMPLATES.items():
            if variant == "photo_group" and hint is None:
                text = TEMPLATES["photo"].format(en=en)
            else:
                text = tpl.format(raw=cls, clean=clean(cls), en=en, group=hint)
            prompt_rows.append({"class": cls, "group": group, "language": language, "variant": variant, "prompt": text})
    unique = sorted({p["prompt"] for p in prompt_rows})
    uniq_emb = text_features(clip, proc, unique)
    index = {t: i for i, t in enumerate(unique)}
    txt_emb = np.stack([uniq_emb[index[p["prompt"]]] for p in prompt_rows])
    # промпты и их эмбеддинги — в одном файле: при проверке «на другой части данных» он не урезается
    np.savez_compressed(
        OUT / "zs_prompts.npz",
        **{k: np.array([p[k] for p in prompt_rows]) for k in ["class", "group", "language", "variant", "prompt"]},
        emb=txt_emb.astype(np.float16),
    )

    # миниатюры 64×64 для части картинок открытой половины
    thumbs, thumb_ids = [], []
    for r in public:
        if r["class"] in THUMB_CLASSES:
            img = Image.open(CACHE / "train" / r["ID"]).convert("RGB")
            side = min(img.size)
            left, top = (img.width - side) // 2, (img.height - side) // 2
            thumbs.append(np.asarray(img.crop((left, top, left + side, top + side)).resize((64, 64), Image.LANCZOS)))
            thumb_ids.append(r["ID"])
    np.savez_compressed(OUT / "zs_thumbs.npz", ids=np.array(thumb_ids), images=np.stack(thumbs).astype(np.uint8))

    # скрытая половина — для соревнования 2: эмбеддинги без ответов (пока в .cache), ответы — в private/
    np.save(CACHE / "hidden_image_emb.npy", hid_emb.astype(np.float16))
    with open(CACHE / "hidden.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["ID", "class", "group", "language", "english"])
        w.writeheader()
        w.writerows(hidden)
    PRIVATE.mkdir(parents=True, exist_ok=True)
    answers = {"competition": "zero-shot-images", "ids": [r["ID"] for r in hidden], "classes": [r["class"] for r in hidden]}
    (PRIVATE / "answers.json").write_text(json.dumps(answers, ensure_ascii=False), encoding="utf-8")

    # проверка: наш расчёт совпадает с настоящим pipeline zero-shot-image-classification
    from transformers import pipeline
    pipe = pipeline("zero-shot-image-classification", model=CLIP)
    labels = ["lion", "polar bear", "pizza", "airplanes"]
    r0 = next(r for r in public if r["class"] == "panthera-leo")
    real = pipe(Image.open(CACHE / "train" / r0["ID"]).convert("RGB"), candidate_labels=labels)
    t = text_features(clip, proc, [f"This is a photo of {lab}." for lab in labels])
    i0 = pub_emb[[r["ID"] for r in public].index(r0["ID"])]
    logits = 100 * (t @ i0)
    ours = np.exp(logits - logits.max())
    ours /= ours.sum()
    print("pipeline:", [(x["label"], round(x["score"], 4)) for x in real])
    print("наш расчёт:", sorted(zip(labels, ours.round(4)), key=lambda kv: -kv[1]))
    print("открытая половина:", len(public), "| скрытая:", len(hidden), "| промптов:", len(prompt_rows),
          "| уникальных:", len(unique), "| миниатюр:", len(thumbs))


def save_competition():
    """Соревнование 2: скрытая половина картинок под новыми ID (без класса) и ответы для сервера.

    Новые ID нужны, чтобы ответы нельзя было подсмотреть по именам файлов в архиве соревнования из материалов курса.
    Нужны файлы .cache/zs/hidden.csv и hidden_image_emb.npy (их создаёт часть clip).
    """
    rows = list(csv.DictReader(open(CACHE / "hidden.csv", encoding="utf-8")))
    emb = np.load(CACHE / "hidden_image_emb.npy")
    order = np.random.default_rng(SEED + 1).permutation(len(rows))
    ids = [f"t{k:03d}" for k in range(1, len(rows) + 1)]
    with open(OUT / "competition_zs_test.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["ID", "group", "language"])
        for new_id, i in zip(ids, order):
            w.writerow([new_id, rows[i]["group"], rows[i]["language"]])
    np.save(OUT / "competition_zs_test.npy", emb[order].astype(np.float16))     # строки — как в competition_zs_test.csv
    with open(OUT / "competition_zs_sample_submission.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["ID", "predicted_class"])
        for new_id in ids:
            w.writerow([new_id, "BACKGROUND_Google"])
    PRIVATE.mkdir(parents=True, exist_ok=True)
    answers = {"competition": "zero-shot-images", "ids": ids, "classes": [rows[i]["class"] for i in order]}
    (PRIVATE / "answers.json").write_text(json.dumps(answers, ensure_ascii=False), encoding="utf-8")
    # список классов — открытая информация (он же в zs_prompts.npz): по нему сервер и браузер проверяют формат ответа
    with np.load(OUT / "zs_prompts.npz") as data:
        classes = sorted({str(c) for c in data["class"]})
    (ROOT / "src" / "lib" / "competitions" / "zero-shot-classes.json").write_text(
        json.dumps(classes, ensure_ascii=False, indent=0) + "\n", encoding="utf-8")
    print("соревнование 2:", len(ids), "скрытых картинок,", len(classes), "классов")


if __name__ == "__main__":
    parts = set(sys.argv[1:]) or {"reviews", "attention", "clip", "competition"}
    os.makedirs(OUT, exist_ok=True)
    if "reviews" in parts:
        save_vocab_and_reviews()
    if "attention" in parts:
        save_attention()
    if "clip" in parts:
        if not (CACHE / "train" / "labels.csv").exists():
            CACHE.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(ZIP) as z:
                z.extractall(CACHE, members=[m for m in z.namelist() if m.startswith("train/")])
        pub, hid = split_competition()
        save_clip(pub, hid)
    if "competition" in parts:
        save_competition()
