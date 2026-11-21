---
id: m8-l0
title: "Разминка: от линейной модели к нейрону"
type: warmup
duration: 10
summary: "Нейронная сеть — не чёрный ящик, а несколько знакомых деталей: взвешенная сумма признаков, как у линейной регрессии, функция потерь, градиентный спуск, проверка на validation. Вспоминаем их на ценах машин и находим слабое место линейной модели — отрицательные цены, — которое исправит первый же нейрон."
files: [cars_processed.csv]
setup: |
  import numpy as np
  import pandas as pd
  from sklearn.model_selection import train_test_split
  from sklearn.preprocessing import StandardScaler
  from sklearn.linear_model import LinearRegression
  from sklearn.metrics import mean_absolute_error
  df = pd.read_csv('cars_processed.csv')
  features = ['Year', 'Distance', 'Engine', 'km_year']
  X, y = df[features], df['Price']
  X_temp, X_test, y_temp, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
  X_train, X_valid, y_train, y_valid = train_test_split(X_temp, y_temp, test_size=0.25, random_state=42)
  scaler = StandardScaler().fit(X_train)
  X_train_s, X_valid_s = scaler.transform(X_train), scaler.transform(X_valid)
sources:
  - "Workshops/08_Neural_Networks_Intro.ipynb — раздел 1 «Данные и линейная модель»"
  - "Lec/06_LLM.pptx — модель искусственного нейрона, обучение градиентным спуском"
---

## Зачем это нужно

В модуле 8 мы соберём нейронную сеть — и окажется, что почти все её детали уже знакомы:

- прогноз линейной регрессии — взвешенная сумма признаков плюс свободный член (урок 5.6). Нейрон считает то же самое;
- признаки в одном масштабе — StandardScaler, обученный на train (урок 5.7);
- функция потерь MSE и градиентный спуск — шаги против градиента (урок 5.2). Сеть учится так же, только параметров больше;
- переобучение: на train ошибка падает, на validation — растёт (урок 5.3, кривая ошибки — урок 6.3).

Данные — четыре числовых признака машин из модуля 5 и то же разбиение: 19 239 / 6 414 / 6 414.

## Линейная модель — взвешенная сумма

```python
linear = LinearRegression().fit(X_train_s, y_train)
print('Веса:', dict(zip(features, linear.coef_.round(0))), '| свободный член:', round(linear.intercept_))
x0 = X_valid_s[0]                          # первая машина validation после масштабирования
print('Признаки:', X_valid.iloc[0].to_dict())
print('Вручную:', round((x0 * linear.coef_).sum() + linear.intercept_), '| predict:', round(linear.predict(X_valid_s[:1])[0]))
print('MAE на validation:', round(mean_absolute_error(y_valid, linear.predict(X_valid_s))))
```

Каждый признак умножается на свой вес, произведения складываются, прибавляется свободный член 9 574 — средняя цена train. Год +4 285 евро на одно стандартное отклонение, пробег −2 241, объём +4 053. MAE — 4 270 евро.

## Слабое место

```python
pred = linear.predict(X_valid_s)
print('Отрицательных прогнозов:', (pred < 0).sum(), 'из', len(pred), f'({(pred < 0).mean():.1%})')
print('Самый низкий прогноз:', round(pred.min()))
```

Для 7,9 % машин validation линейная модель предсказывает **отрицательную** цену — вплоть до −22 652 евро. Прямая продолжается вниз сколько угодно, а цена — нет. В уроке 8.1 появится нейрон с функцией активации ReLU: он умеет «срезать» всё, что ниже нуля, и это первый шаг к нелинейной модели.
