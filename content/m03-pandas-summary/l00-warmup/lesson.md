---
id: m3-l0
title: "Разминка: фильтры, частоты и статистики"
type: warmup
duration: 10
summary: Вспоминаем фильтры строк, частоты категорий, медиану и квартили, новые колонки и сортировку — на подготовленной таблице из модуля 2.
files: [cars_processed.csv]
setup: |
  import numpy as np
  import pandas as pd
  df = pd.read_csv('cars_processed.csv')   # результат модуля 2
sources:
  - "Workshops/03_Pandas_сводный_анализ_Styler.ipynb — «Нужно знать» и раздел 1 «Загрузка данных»"
---

## Зачем это нужно

В модуле 3 мы будем отвечать на вопросы аналитика: какие марки хорошо представлены, какая цена типична для сегмента, где данных мало. Для этого понадобятся инструменты модулей 1–2 — фильтры, частоты, медиана и квартили, новые колонки, сортировка. Пять коротких задач вернут их в рабочую память.

Работаем с подготовленной таблицей `cars_processed.csv` — результатом модуля 2 (32 067 строк, короткие имена колонок `Engine` и `Price`, признаки `Age`, `km_year`, `Transmission`, редкие марки в `Rare`).

```python
print(df.shape)
print(df.columns.tolist())
df.head(3)
```

## Короткая памятка

```python
diesel_auto = df[(df['Fuel_type'] == 'Diesel') & (df['Transmission'] == 'Automatic')]   # фильтр — урок 2.5
print('Дизель с автоматом:', len(diesel_auto))
print(df['Style'].value_counts(normalize=True).head(3).round(3))                         # частоты — урок 2.3
q1, q3 = df['Price'].quantile([0.25, 0.75])                                              # квартили — урок 1.7
print('Медиана цены:', df['Price'].median(), '| Q1–Q3:', q1, '–', q3)
```

У Series есть метод `quantile` — тот же квантиль, что `np.quantile` из урока 1.7.
