# Скачивание двух моделей модуля 9 в .cache/hf и сверка с выводами Workshops/09_HF_intro.ipynb.
# Запуск: HF_HOME=.cache/hf .cache/hf-venv/bin/python scripts/hf/check_models.py
import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification, CLIPModel, CLIPProcessor

SST2 = "distilbert/distilbert-base-uncased-finetuned-sst-2-english"
CLIP = "openai/clip-vit-base-patch32"

tok = AutoTokenizer.from_pretrained(SST2)
model = AutoModelForSequenceClassification.from_pretrained(SST2).eval()
raw = ["I've been ready for a HuggingFace course my whole life.", "I hate this huggingface so much!"]
print(tok.tokenize(raw[1]))
inputs = tok(raw, padding=True, truncation=True, return_tensors="pt")
print(inputs["input_ids"])
with torch.inference_mode():
    logits = model(**inputs).logits
print(logits, torch.softmax(logits, dim=-1), model.config.id2label)

clip = CLIPModel.from_pretrained(CLIP).eval()
proc = CLIPProcessor.from_pretrained(CLIP)
print("CLIP params:", sum(p.numel() for p in clip.parameters()), "logit_scale:", float(clip.logit_scale.exp()))
