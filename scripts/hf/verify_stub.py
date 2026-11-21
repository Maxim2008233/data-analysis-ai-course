# -*- coding: utf-8 -*-
"""Сверка браузерной версии transformers (public/py/stubs/transformers) с настоящей библиотекой.

Запуск: HF_HOME=.cache/hf HF_HUB_OFFLINE=1 .cache/hf-venv/bin/python scripts/hf/verify_stub.py
"""
import glob
import importlib.util
import os
import re
import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from transformers import AutoTokenizer, AutoModelForSequenceClassification, pipeline as real_pipeline

ROOT = Path(__file__).resolve().parents[2]
STUB_DIR = ROOT / "public/py/stubs/transformers"
spec = importlib.util.spec_from_file_location("stub_transformers", STUB_DIR / "__init__.py", submodule_search_locations=[str(STUB_DIR)])
stub = importlib.util.module_from_spec(spec)
sys.modules["stub_transformers"] = stub
spec.loader.exec_module(stub)

SST2 = "distilbert/distilbert-base-uncased-finetuned-sst-2-english"
real_tok = AutoTokenizer.from_pretrained(SST2)
os.chdir(ROOT / "public/data")
my_tok = stub.AutoTokenizer.from_pretrained("distilbert-base-uncased-finetuned-sst-2-english")

# ---------- 1. токенизатор на текстах курса и трудных строках ----------
texts = set()
for f in glob.glob(str(ROOT / "content/**/*.md"), recursive=True) + glob.glob(str(ROOT / "content/**/*.yaml"), recursive=True):
    for line in Path(f).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            texts.add(line[:400])
edge = [
    "I've been ready for a HuggingFace course my whole life.", "café naïve résumé Ångström", "Привет, мир! Как дела?",
    "東京は日本の首都です", "emoji 😀👍🏽 test", "a" * 150, "x" + "y" * 99, "[CLS] hello [SEP] world [PAD]", "[cls] lower [sep]",
    "tab\there\nnewline\r\nend", "  multiple   spaces  ", "", "   ", "e-mail: test@example.com, https://huggingface.co/models?x=1",
    "Don't won't can't it's they're", "3.14159 1,000,000 $100 50% #hashtag", "İstanbul ǅemal ﬁne", "​zero​width",
    "中文和English混合", "ÄÖÜäöüß", "Ελληνικά", "עברית", "العربية", "हिन्दी", "́accent", "x\u0000y�z",
]
texts.update(edge)
texts = sorted(texts)
bad = 0
for t in texts:
    a, b = my_tok.tokenize(t), real_tok.tokenize(t)
    if a != b:
        bad += 1
        if bad <= 8:
            print("ТОКЕНЫ РАЗНЫЕ:", repr(t[:80]), a[:12], b[:12])
print("токенизация: строк", len(texts), "расхождений", bad)

# ---------- 2. полный вызов: padding, truncation, attention_mask, decode ----------
batches = [texts[i:i + 7] for i in range(0, 700, 7)]
bad = 0
for batch in batches:
    for kw in ({"padding": True}, {"padding": True, "truncation": True, "max_length": 12}, {"padding": "max_length", "max_length": 40, "truncation": True}):
        a = my_tok(batch, return_tensors="np", **kw)
        b = real_tok(batch, return_tensors="np", **kw)
        if not (np.array_equal(a["input_ids"], b["input_ids"]) and np.array_equal(a["attention_mask"], b["attention_mask"])):
            bad += 1
            if bad <= 3:
                print("ВЫЗОВ РАЗНЫЙ:", kw, batch[:2])
print("вызовы с padding/truncation: проверено", len(batches) * 3, "расхождений", bad)
bad = 0
for t in texts[:2000]:
    ids = real_tok(t)["input_ids"]
    for skip, clean in ((False, False), (True, False), (True, True)):
        if my_tok.decode(ids, skip_special_tokens=skip, clean_up_tokenization_spaces=clean) != real_tok.decode(ids, skip_special_tokens=skip, clean_up_tokenization_spaces=clean):
            bad += 1
            if bad <= 5:
                print("DECODE:", repr(my_tok.decode(ids, skip_special_tokens=skip)[:80]), "|", repr(real_tok.decode(ids, skip_special_tokens=skip)[:80]))
print("decode: расхождений", bad)

# ---------- 3. модель и pipeline тональности ----------
import csv
reviews = [r["text"] for r in csv.DictReader(open("reviews.csv", encoding="utf-8"))]
model = AutoModelForSequenceClassification.from_pretrained(SST2).eval()
print("параметров у настоящей модели:", sum(p.numel() for p in model.parameters()))
my_model = stub.AutoModelForSequenceClassification.from_pretrained(SST2)
enc_r = real_tok(reviews, padding=True, return_tensors="pt")
with torch.inference_mode():
    real_logits = model(**enc_r).logits.numpy()
my_logits = my_model(**my_tok(reviews, padding=True, return_tensors="np")).logits
print("логиты: наибольшее расхождение (padding в батче)", float(np.abs(real_logits - my_logits).max()))
rp = real_pipeline("sentiment-analysis", model=SST2)(reviews)
mp = stub.pipeline("sentiment-analysis")(reviews)
print("pipeline: метки совпали", sum(a["label"] == b["label"] for a, b in zip(rp, mp)), "из", len(reviews),
      "| наибольшее расхождение score", max(abs(a["score"] - b["score"]) for a, b in zip(rp, mp)))

# ---------- 4. zero-shot картинки: наш расчёт против настоящего pipeline ----------
pub = list(csv.DictReader(open("zs_public.csv", encoding="utf-8")))
real_zs = real_pipeline("zero-shot-image-classification", model="openai/clip-vit-base-patch32")
my_zs = stub.pipeline("zero-shot-image-classification")
raw_labels = sorted({str(c) for c in np.load("zs_prompts.npz")["class"]})
rng = np.random.default_rng(1)
worst = 0.0
agree = 0
for r in [pub[i] for i in rng.choice(len(pub), 12, replace=False)]:
    labels = list(rng.choice(raw_labels, 6, replace=False))
    if r["class"] not in labels:
        labels[0] = r["class"]
    a = real_zs(Image.open(ROOT / ".cache/zs/train" / r["ID"]).convert("RGB"), candidate_labels=labels)
    b = my_zs(r["ID"], candidate_labels=labels)
    da = {x["label"]: x["score"] for x in a}
    db = {x["label"]: x["score"] for x in b}
    worst = max(worst, max(abs(da[k] - db[k]) for k in labels))
    agree += a[0]["label"] == b[0]["label"]
    print(r["ID"], r["class"], "| настоящий:", a[0]["label"], round(a[0]["score"], 3), "| наш:", b[0]["label"], round(b[0]["score"], 3))
print("zero-shot: лучшая метка совпала", agree, "из 12 | наибольшее расхождение вероятности", round(worst, 4))
