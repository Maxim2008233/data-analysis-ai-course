---
id: m4-l10
title: "Интерактивные графики: Plotly"
duration: 16
summary: "Plotly Express: интерактивный scatter и боксплоты с подсказками при наведении, возврат от точки к записи по source_row_id, treemap «марка → модель» и фильтр сегмента — словарь условий вместо виджетов."
introduces: [plotly-express, plotly-treemap, segment-filter]
uses: [pd-agg, pd-bool-filter, hue-channel]
files: [cars_processed.csv]
setup: |
  import numpy as np
  import pandas as pd
  import plotly.express as px
  df = pd.read_csv('cars_processed.csv')
sources:
  - "Workshops/04_BI_визуализация.ipynb — раздел «Интерактивная визуализация» (Plotly: scatter с hover_data, px.box, px.histogram с rug)"
  - "Workshops/04_BI_визуализация.ipynb — «treemap и фильтры», «Фильтры для исследования конкретного сегмента» (ipywidgets)"
---

## Зачем это нужно

На статичном графике видно, что точка далеко от облака, но не видно, **какая это запись**. Интерактивный график отвечает на это сразу: наводим курсор — и видим марку, модель, год и номер строки; выделяем рамкой область — и она приближается; щёлкаем по легенде — и группа скрывается. Такие графики удобны и для поиска ошибок, и для показа заказчику: он сам может «покрутить» данные. В Python для этого есть библиотека **Plotly**.

## Plotly Express: первый интерактивный график

Модуль `plotly.express` (сокращённо `px`) строит график одной функцией — похоже на Seaborn: таблица, имена колонок, цвет. Функция возвращает объект-рисунок `fig`, а `fig.show()` показывает его. Чтобы цвета различались, оставим пять самых частых марок (без группы `Rare`), а остальные объединим в «Другие»:

```python
top5 = df.loc[df['Make'] != 'Rare', 'Make'].value_counts().head(5).index
df_viz = df.copy()
df_viz['Марка на графике'] = 'Другие'
df_viz.loc[df_viz['Make'].isin(top5), 'Марка на графике'] = df_viz['Make']

fig = px.scatter(df_viz, x='Year', y='Price', color='Марка на графике', log_y=True, opacity=0.4,
                 hover_data=['source_row_id', 'Make', 'Model', 'Distance'],
                 title='Цена предложения и год выпуска',
                 labels={'Year': 'Год выпуска', 'Price': 'Цена, евро'})
fig.update_layout(height=450)
fig.show()
```

- `color=` — колонка для цвета (как `hue` в Seaborn), `opacity` — прозрачность, `log_y=True` — логарифмическая ось Y;
- `hover_data=[...]` — колонки, которые появятся в подсказке при наведении;
- `labels={...}` — подписи осей и легенды вместо имён колонок;
- `fig.update_layout(height=450)` — высота в пикселях.

Попробуйте: наведите курсор на точку, выделите мышью область, дважды щёлкните — масштаб вернётся; щёлкните по «Другие» в легенде — группа скроется.

## От точки к записи

Подсказка показывает `source_row_id` — номер строки исходного `cars.csv`. По нему подозрительную точку легко найти в таблице. Например, точка KIA за 490 000 евро над облаком 2018 года:

```python
df[df['source_row_id'] == 20055][['Make', 'Model', 'Year', 'Distance', 'Price']]
```

Без номера в подсказке пришлось бы искать запись по сочетанию марки, года и цены — а таких строк может быть несколько.

## Боксплоты с подсказками

У `px.box` точки за усами тоже интерактивные: наводим — видим запись.

```python
fig = px.box(df, x='Fuel_type', y='Price', color='Transmission', log_y=True,
             hover_data=['source_row_id', 'Make', 'Model'],
             title='Цена по типу топлива и коробке передач (наведите на точки за усами)',
             labels={'Price': 'Цена, евро', 'Fuel_type': 'Тип топлива'})
fig.show()
```

Наведите на сам ящик — Plotly покажет медиану, квартили и границы усов: те же числа, что вы считали в уроке 4.6.

## Treemap: из чего состоит каталог

**Treemap** показывает иерархию прямоугольниками: внешние — марки, вложенные — модели. Площадь — число записей, цвет — средняя цена. Таблицу готовим группировкой (урок 3.2) и `reset_index()`, чтобы марка и модель стали колонками:

```python
model_stats = (df.groupby(['Make', 'Model'])
                 .agg(count=('Price', 'size'), avg_price=('Price', 'mean'))
                 .reset_index())
fig = px.treemap(model_stats, path=['Make', 'Model'], values='count', color='avg_price',
                 color_continuous_scale='RdYlBu_r', title='Каталог: марка → модель',
                 labels={'count': 'Число записей', 'avg_price': 'Средняя цена, €'})
fig.update_layout(height=550, margin=dict(t=50, l=10, r=10, b=10))
fig.show()
```

- `path=['Make', 'Model']` — уровни иерархии сверху вниз;
- `values='count'` — площадь, `color='avg_price'` — цвет, `color_continuous_scale` — палитра от синего (дешевле) к красному (дороже).

Щёлкните по марке — treemap приблизит её модели; щелчок по заголовку сверху вернёт весь каталог. Treemap удобен для **обзора** состава: какие марки и модели занимают больше всего места. Точно сравнивать площади трудно — для этого есть столбцы (урок 4.3).

## Фильтр сегмента

В лабораторной фильтры подключают к выпадающим спискам — виджетам `ipywidgets`: выбрали марку — график перерисовался. Устроено это так: функция фильтрует таблицу по выбранным значениям, а виджеты вызывают её при каждом изменении.

```python norun
import ipywidgets as widgets            # в Jupyter; в тренажёре виджетов нет
make_widget = widgets.Dropdown(options=['(Все)'] + sorted(df['Make'].unique()), description='Марка:')
make_widget.observe(update_plot, names='value')   # при выборе вызывается update_plot
```

Главное здесь — сама функция фильтра; её можно писать и проверять без виджетов. Фильтры собираем в **словарь** «колонка → значение», где `None` означает «все значения»:

```python
def apply_filters(data, filters):
    for column, value in filters.items():
        if value is not None:
            data = data[data[column] == value]
    return data

filters = {'Make': 'Toyota', 'Fuel_type': 'Hybrid', 'Transmission': None}
segment = apply_filters(df, filters)
fig = px.scatter(segment, x='Year', y='Price', hover_data=['source_row_id', 'Model', 'Distance'],
                 title=f'Toyota, гибрид: {len(segment)} записей, медиана цены {segment["Price"].median():.0f} евро',
                 labels={'Year': 'Год выпуска', 'Price': 'Цена, евро'})
fig.show()
```

Поменяйте значения в словаре и запустите снова — это и есть «фильтр» тренажёра. В заголовок попадают размер сегмента и медианная цена: при выборе узкого сегмента сразу видно, хватает ли в нём данных (урок 3.3).

## Типичные ошибки

:::mistake Нет номера записи в подсказке
Без `source_row_id` (или другого номера) в `hover_data` найденную точку не найти в таблице. Добавляйте номер строки в подсказку.
:::

:::mistake Цвет для 22 марок
Как и в Seaborn, много цветов не различить. Оставьте главные категории, остальные объедините в «Другие».
:::

:::mistake Treemap по сырым строкам
Treemap рисуют по агрегированной таблице (`groupby` + `agg` + `reset_index`), а не по 32 тысячам строк.
:::

:::mistake Интерактив там, где нужна печать
В отчёте-PDF интерактивность пропадает. Для печати — статичный Matplotlib; Plotly — для исследования и показа на экране.
:::

## Мини-квиз

```quiz
- q: "Зачем в `hover_data` добавляют `source_row_id`?"
  options:
    - Чтобы по точке на графике найти запись в таблице
    - Чтобы точки стали крупнее
    - Без него Plotly не строит график
  answer: 0
  explain: "Номер строки в подсказке — «ключ» от точки к записи: `df[df['source_row_id'] == номер]`."
- q: "Что задаёт `path=['Make', 'Model']` в `px.treemap`?"
  options:
    - Порядок сортировки строк
    - Уровни иерархии — сначала марка, внутри неё модели
    - Цвет прямоугольников
  answer: 1
  explain: Площадь задаёт `values`, цвет — `color`, а `path` — вложенность.
- q: "В словаре фильтров `{'Make': 'BMW', 'Fuel_type': None}`. Какие записи отберёт `apply_filters`?"
  options:
    - Только BMW с любым топливом
    - BMW без указанного топлива
    - Все записи
  answer: 0
  explain: "`None` означает «все значения», поэтому условие по топливу не применяется."
```

## Что запомнить

- `fig = px.scatter(df, x=..., y=..., color=..., hover_data=[...], labels={...}, title=...)`, затем `fig.show()`; так же `px.box`, `px.histogram`.
- Номер строки (`source_row_id`) в подсказке ведёт от точки к записи в таблице.
- `px.treemap(table, path=['Make', 'Model'], values='count', color='avg_price')` — обзор состава по иерархии; таблица — после `groupby` и `reset_index()`.
- Фильтр сегмента — функция, которая применяет словарь условий («колонка → значение», `None` — все); в Jupyter к ней подключают виджеты.
