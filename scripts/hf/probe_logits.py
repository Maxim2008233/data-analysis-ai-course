import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification
SST2 = "distilbert/distilbert-base-uncased-finetuned-sst-2-english"
tok = AutoTokenizer.from_pretrained(SST2)
model = AutoModelForSequenceClassification.from_pretrained(SST2).eval()
for s in ["I hate this so much!", "I hate this huggingface so much!"]:
    with torch.inference_mode():
        print(s, model(**tok(s, return_tensors="pt")).logits.numpy().round(4))
