---
id: m7-l0
title: "Разминка: какие признаки мы ещё не использовали"
type: warmup
duration: 10
summary: "Все модели модулей 5–6 видели только четыре числовых признака. А марка, модель, кузов, топливо и коробка передач лежат в таблице без дела. Вспоминаем инструменты модулей 2–4, которые понадобятся для категорий: map, value_counts, редкие категории, оценку «как у похожих» и боксплоты."
files: [cars_processed.csv]
setup: |
  import numpy as np
  import pandas as pd
  from sklearn.model_selection import train_test_split
  df = pd.read_csv('cars_processed.csv')
  features = ['Make', 'Model', 'Year', 'Style', 'Distance', 'Engine', 'Fuel_type', 'AutoTransmission', 'km_year']
  X, y = df[features], df['Price']
  X_temp, X_test, y_temp, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
  X_train, X_valid, y_train, y_valid = train_test_split(X_temp, y_temp, test_size=0.25, random_state=42)
sources:
  - "Workshops/07_Категории_Ridge_LightGBM.ipynb — раздел 1 «Загрузка и разбиение данных»: числовые и текстовые признаки"
---

## Зачем это нужно

Лучшая модель модуля 6 — случайный лес — ошибается в среднем на 2 658 евро. Она знает про машину только год, пробег, объём двигателя и пробег в год. Но покупатель смотрит в первую очередь на **марку и модель**: «Мерседес 2015 года» и «Дачия 2015 года» стоят по-разному. Эти признаки — **категориальные**: их значения — слова, а не числа. В модуле 7 научимся передавать их моделям.

Пригодится знакомое:

- числовые и категориальные признаки (урок 3.1);
- `map` — замена по словарю (урок 2.9) и `value_counts` — частоты категорий (урок 2.3);
- редкие категории (урок 2.10) и надёжность статистики маленькой группы (урок 3.3);
- значение «как у похожих» через группировку (уроки 3.2 и 3.6);
- боксплот: ящик, усы и точки за усами (урок 4.6).

## Признаки модуля 7

Берём девять признаков. Четыре из них — текст:

| Признак | Значений | Пример |
|---|---:|---|
| `Make` — марка | 22 | Toyota, BMW, `Rare` (61 редкая марка, объединённая в уроке 2.10) |
| `Model` — модель | 789 | E Class, 5 Series, Passat… |
| `Style` — кузов | 12 | Sedan, Universal, Hatchback… |
| `Fuel_type` — топливо | 6 | Diesel, Petrol, Metan/Propan, Hybrid… |
| `AutoTransmission` — коробка | 2 | True (автомат), False (механика) |

```python
print(X.select_dtypes(include=['object', 'string']).columns.tolist())
print(X[['Make', 'Model', 'Style', 'Fuel_type']].nunique())
print(df['Fuel_type'].value_counts())
```

Разбиение — то же, что в модулях 5–6: те же 19 239 / 6 414 / 6 414 машин, чтобы все MAE можно было сравнивать с прошлыми.

## Короткая памятка

```python
auto = X_train['AutoTransmission'].map({True: 1, False: 0})               # урок 2.9
print('Доля автоматов:', round(auto.mean(), 3))
print(y_train.groupby(auto).median())                                      # урок 3.2
counts = X_train['Model'].value_counts()                                   # урок 2.3
print('Моделей:', len(counts), '| по одной машине:', (counts == 1).sum())
model_mean = y_train.groupby(X_train['Model']).mean()                      # «как у похожих», урок 3.6
estimate = X_valid['Model'].map(model_mean).fillna(y_train.mean())
print('MAE «цена — средняя по модели»:', round((estimate - y_valid).abs().mean()))
```

- медианная цена автомата — 11 899 евро, механики — 4 499: коробка передач явно связана с ценой;
- из 725 моделей в обучающей части 129 встречаются по одному разу — их «средняя цена» ненадёжна;
- оценка «цена — средняя по модели» ошибается на ≈ 4 382 евро: одна модель, без года и пробега, мало что говорит. Сила — в **сочетании** категорий с числовыми признаками.
