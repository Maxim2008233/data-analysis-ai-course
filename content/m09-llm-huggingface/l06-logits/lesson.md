---
id: m9-l6
title: "Модель и логиты"
duration: 16
summary: "Разбираем pipeline на шаги, как в ноутбуке курса: токенизатор → модель → softmax. Модель возвращает логиты — сырые оценки классов, которые могут быть любыми числами. Softmax превращает их в вероятности, а model.config.id2label — номера классов в названия. Для двух классов вероятность — сигмоида разности логитов. Повторяем ответы pipeline до восьмого знака и смотрим, на каких отзывах модель колеблется."
introduces: [logits]
uses: [tokenizer, attention-mask, binary-classification]
files: [reviews.csv, distilbert_vocab.txt, sst2_logits.json]
setup: |
  import numpy as np
  import pandas as pd
sources:
  - "Workshops/09_HF_intro.ipynb — «Выполнение действий с моделью по шагам»: AutoTokenizer, AutoModelForSequenceClassification, outputs.logits, softmax, model.config.id2label"
  - "Модель distilbert-base-uncased-finetuned-sst-2-english — логиты для отзывов урока посчитаны настоящей библиотекой (scripts/hf/build_hf_data.py)"
---

## Зачем это нужно

Pipeline удобен, но прячет шаги. Если пройти их самому, можно получить вероятности всех классов, поставить свой порог, обрабатывать большие данные по частям и использовать ответы модели в своём коде. Это понадобится и для дообучения модели (урок 9.9). В ноутбуке курса этот раздел называется «Выполнение действий с моделью по шагам»: токенизатор → модель → постобработка.

## Модель

```python
from transformers import AutoTokenizer, AutoModelForSequenceClassification

name = 'distilbert-base-uncased-finetuned-sst-2-english'
tokenizer = AutoTokenizer.from_pretrained(name)
model = AutoModelForSequenceClassification.from_pretrained(name)
print(model)
print(model.config.id2label)
print('Параметров:', model.num_parameters())
```

`AutoModelForSequenceClassification` — модель для классификации текстов. Это трансформер DistilBERT, к которому приделана **голова** — два полносвязных слоя поверх вектора токена [CLS]. Голова выдаёт по одному числу на каждый класс, как выходной слой сети из урока 8.2. Такую голову без обучения и получила русская модель DeepPavlov в уроке 9.4.

`model.config.id2label` хранит названия классов по номерам: 0 — NEGATIVE, 1 — POSITIVE. Всего у модели 66 955 010 параметров. В браузере их не загрузить: это 268 МБ и PyTorch. Поэтому учебная версия знает логиты, посчитанные заранее для 88 отзывов урока (`model.available_texts()`).

## Логиты

```python
raw_inputs = ["I've been ready for a HuggingFace course my whole life.", 'I hate this huggingface so much!']
inputs = tokenizer(raw_inputs, padding=True, truncation=True, return_tensors='np')
outputs = model(**inputs)
print(outputs.logits)
```

Модель вернула таблицу «тексты × классы». Это **логиты** — сырые оценки классов, выход последнего слоя без активации. Логиты бывают любыми числами: отрицательными, больше единицы, и в сумме они не дают 1. Чем больше логит, тем сильнее модель «голосует» за класс. У первого отзыва NEGATIVE −2,28, POSITIVE 2,36.

В ноутбуке курса во второй строке стоят другие числа, [4,1692; −3,3464]. Туда по ошибке попала фраза «I hate this so much!» без слова «huggingface»: в нашем файле у неё ровно такие логиты.

## Вероятности и метки

```python
def softmax(z):
    e = np.exp(z - z.max(axis=-1, keepdims=True))
    return e / e.sum(axis=-1, keepdims=True)

probs = softmax(outputs.logits)               # softmax каждой строки: один текст — одна строка
print(probs.round(4))
print([model.config.id2label[i] for i in probs.argmax(axis=1)])
```

Softmax по строкам превращает логиты каждого текста в вероятности классов (урок 9.3), а `argmax` и `id2label` — в метку. Получились ровно те числа, которые выдал бы на этих фразах pipeline из урока 9.4: POSITIVE 0,9905 и NEGATIVE 0,998.

Для двух классов softmax — это сигмоида разности логитов:

$$
P(\text{POSITIVE}) = \frac{e^{z_1}}{e^{z_0} + e^{z_1}} = \frac{1}{1 + e^{-(z_1 - z_0)}} = \sigma(z_1 - z_0)
$$

Разность z₁ − z₀ назовём **отрывом**. У первого отзыва отрыв 2,36 − (−2,28) = 4,65, и σ(4,65) = 0,9905. Это та же сигмоида, что у логистической регрессии в уроке 8.7: там тоже на вход шла оценка, а на выход — вероятность класса 1.

## Все отзывы

```python
reviews = pd.read_csv('reviews.csv')
inputs = tokenizer(list(reviews['text']), padding=True, truncation=True, return_tensors='np')
logits = model(**inputs).logits
reviews['margin'] = logits[:, 1] - logits[:, 0]          # отрыв POSITIVE от NEGATIVE
print('Отрыв от', reviews['margin'].min().round(2), 'до', reviews['margin'].max().round(2))
print(reviews.sort_values('margin')[['text', 'margin']].iloc[[0, 1, -2, -1]])
doubtful = reviews['margin'].abs() < 2
print('Сомнительных:', doubtful.groupby(reviews['lang']).sum().to_dict())
```

Отрыв меняется от −8,6 до 9,1, то есть вероятность POSITIVE — от 0,0002 до 0,9999. Самые уверенные ответы — на однозначных отзывах: «The dialogue was awful and the plot made no sense» и «The book is gripping and wonderfully written». Отрыв меньше 2 по модулю означает вероятность от 0,12 до 0,88: модель колеблется. Таких отзывов 9 — три английских и шесть русских.

Модели нужно передавать всё, что вернул токенизатор, вместе с маской (урок 9.5). Без маски учебная версия отказывается считать и объясняет почему:

```python expect-error
model(input_ids=inputs['input_ids'])
```

## Типичные ошибки

:::mistake Принимать логиты за вероятности
Логиты бывают отрицательными и больше единицы, а в сумме не дают 1. Вероятности получают из них через softmax.
:::

:::mistake Гадать, какой класс под каким номером
Названия классов хранит `model.config.id2label`. У другой модели порядок классов может быть другим, а у модели без обученной головы метки вообще бессмысленные: LABEL_0 и LABEL_1.
:::

:::mistake Softmax не по той оси
В таблице логитов строка — текст, столбец — класс. Softmax считают по строкам (`axis=-1`): вероятности классов одного текста в сумме дают 1.
:::

## Мини-квиз

```quiz
- q: Модель вернула для отзыва логиты [−2,28; 2,36]. Что это?
  options:
    - Сырые оценки классов NEGATIVE и POSITIVE. Вероятности из них даст softmax
    - Вероятности классов
    - Номера токенов отзыва
  answer: 0
  explain: Логиты — выход последнего слоя без активации, они могут быть любыми числами.
- q: Как для двух классов получить вероятность класса 1 из логитов z₀ и z₁?
  options:
    - σ(z₁ − z₀) — сигмоида разности логитов, то же самое даёт softmax
    - z₁ / (z₀ + z₁)
    - Взять z₁, если он больше нуля
  answer: 0
  explain: e^z₁ / (e^z₀ + e^z₁) после деления на e^z₁ превращается в сигмоиду разности.
- q: Что хранит model.config.id2label?
  options:
    - Названия классов по их номерам — 0 → NEGATIVE, 1 → POSITIVE
    - Словарь токенизатора
    - Правильные ответы для отзывов
  answer: 0
  explain: По номеру класса с наибольшей вероятностью находят его название.
- q: Логиты отзыва — [1,0; 1,2]. Уверена ли модель?
  options:
    - Нет — отрыв всего 0,2, вероятность POSITIVE около 0,55
    - Да — оба логита больше нуля
    - Да — логит POSITIVE больше 1
  answer: 0
  explain: Важна разность логитов, а не их величина. σ(0,2) ≈ 0,55.
```

## Что запомнить

- Модель классификации — трансформер с «головой»: `model(**inputs).logits` даёт по оценке на каждый класс для каждого текста.
- Логиты — любые числа. Softmax по строкам превращает их в вероятности, `model.config.id2label` — номера классов в названия.
- Для двух классов P(класс 1) = σ(z₁ − z₀): чем больше отрыв, тем увереннее модель.
- Pipeline = токенизатор → модель → softmax → id2label. Пройдя эти шаги самостоятельно, получаем те же числа.
