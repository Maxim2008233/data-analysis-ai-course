---
id: b1-l3
title: "Несбалансированные классы: гибриды среди машин"
duration: 20
optional: true
summary: "Гибридов среди машин курса 5,6 %. Логистическая регрессия при пороге 0,5 не находит ни одного и при этом ошибается чаще, чем ответ «гибридов нет». Доля верных такую модель не разоблачает. Веса классов, дублирование и прореживание поднимают полноту ценой точности, но не делают модель лучше: AUC почти не меняется. Сдвиг порога даёт тот же выбор без переобучения. Дублирование до разбиения создаёт утечку: «точность» 0,69 вместо честных 0,12. Настоящее улучшение дают признаки: с маркой и моделью площадь под кривой «точность — полнота» растёт с 0,16 до 0,75."
introduces: [class-imbalance, rebalancing]
uses: [precision-recall, roc-auc, data-leakage]
files: [cars_processed.csv]
setup: |
  import numpy as np
  import pandas as pd
  import matplotlib.pyplot as plt
  from sklearn.model_selection import train_test_split
  from sklearn.preprocessing import StandardScaler, OneHotEncoder
  from sklearn.compose import make_column_transformer
  from sklearn.pipeline import make_pipeline
  from sklearn.linear_model import LogisticRegression
  from sklearn.metrics import precision_score, recall_score, f1_score, roc_auc_score, average_precision_score, precision_recall_curve
  cars = pd.read_csv('cars_processed.csv')
  features = ['Year', 'Distance', 'Engine', 'Price']
  X = cars[features + ['Make', 'Model']]
  y = (cars['Fuel_type'] == 'Hybrid').astype(int)
  X_temp, X_test, y_temp, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
  X_train, X_valid, y_train, y_valid = train_test_split(X_temp, y_temp, test_size=0.25, random_state=42, stratify=y_temp)

  def report(name, p, y_true=None, threshold=0.5):
      y_true = y_valid if y_true is None else y_true
      pred = (p >= threshold).astype(int)
      print(f'{name:24} доля верных {np.mean(pred == y_true):.3f} | точность {precision_score(y_true, pred, zero_division=0):.3f} '
            f'полнота {recall_score(y_true, pred):.3f} F1 {f1_score(y_true, pred):.3f} | AUC {roc_auc_score(y_true, p):.3f} | назван гибридом {pred.mean():.1%}')
sources:
  - "addition/lab8 - water-quality_balance.ipynb — вопрос «сбалансирована ли выборка?», сравнение классификаторов, ROC-кривые"
  - "MLtextbook/Глава_4_Логистическая_Регрессия_Синтетические_данные.ipynb — StratifiedKFold, f1_score"
---

## Зачем это нужно

Редкие классы — норма, а не исключение. Мошеннических платежей — доли процента, бракованных деталей — единицы на тысячу, тяжёлых болезней среди обследованных — несколько процентов. Именно редкий класс обычно и нужно найти.

Возьмём задачу с машинами курса: по году, пробегу, объёму двигателя и цене найти **гибриды**, например для фильтра «экологичные машины». Гибридов 1808 из 32 067 — 5,6 %. Это **несбалансированные классы**: один встречается гораздо реже другого. Данные разбиты на три части 60/20/20 с `stratify=y`, чтобы доля гибридов во всех частях была одинаковой. В валидационной части их 362 из 6414.

## Доля верных обманывает

```python
plain = make_pipeline(StandardScaler(), LogisticRegression()).fit(X_train[features], y_train)
p_plain = plain.predict_proba(X_valid[features])[:, 1]
print(f'ответ «гибридов нет»: доля верных {1 - y_valid.mean():.3f}')
report('модель, порог 0,5', p_plain)
```

Модель верна в 94,2 % случаев — и не нашла ни одного гибрида: полнота 0. Ответ «гибридов нет» верен даже чаще, в 94,4 % случаев. При этом AUC 0,79: модель кое-что знает и ставит гибриды выше остальных машин. Но её вероятности для гибридов редко дотягивают до 0,5: если гибридов 5,6 %, у типичной машины и вероятность около 5 %. Порог 0,5 придуман для равных классов.

Вывод первый: при редком классе смотрят на полноту, точность, F1 и площадь под кривой «точность — полнота», а не на долю верных.

## Веса классов

Первый способ помочь редкому классу — сделать ошибку на нём дороже. `class_weight='balanced'` даёт каждому классу вес n / (2·nₖ), где nₖ — число объектов класса:

```python
n, n1 = len(y_train), y_train.sum()
print(f'веса: механик и прочих {n / (2 * (n - n1)):.2f}, гибридов {n / (2 * n1):.2f}')
balanced = make_pipeline(StandardScaler(), LogisticRegression(class_weight='balanced')).fit(X_train[features], y_train)
p_bal = balanced.predict_proba(X_valid[features])[:, 1]
report('веса классов', p_bal)
```

Ошибка на гибриде теперь в 17 раз дороже ошибки на обычной машине. Полнота выросла с 0 до 0,80. Цена — точность 0,12: из восьми машин с меткой «гибрид» гибрид только одна, и метку получила треть всех машин. AUC не изменился: веса сдвинули вероятности, но не научили модель лучше отличать гибриды. Доля верных упала до 0,67, но для этой задачи она и не была мерой.

## Дублирование и прореживание

Второй способ — изменить саму обучающую выборку: продублировать гибриды (oversampling), пока их не станет столько же, сколько остальных, или выбросить часть остальных (undersampling):

```python
rng = np.random.default_rng(0)
yt = y_train.to_numpy()
pos, neg = np.where(yt == 1)[0], np.where(yt == 0)[0]
extra = rng.choice(pos, size=len(neg) - len(pos), replace=True)       # случайные повторы гибридов
idx = np.concatenate([np.arange(len(yt)), extra])
over = make_pipeline(StandardScaler(), LogisticRegression()).fit(X_train[features].iloc[idx], y_train.iloc[idx])
report('дублирование', over.predict_proba(X_valid[features])[:, 1])
```

Результат почти тот же, что с весами: повторить гибрид 17 раз — то же, что дать ему вес 17. Дублируют только обучающую часть. Валидация и тест остаются как есть: на них модель встретит настоящую долю гибридов.

## Сдвиг порога

Третий способ вообще не трогает обучение: можно оставить модель как есть и опустить порог. Кривая «точность — полнота» показывает все пороги сразу. Выберем на валидации порог с наибольшим F1 и проверим его на тесте:

```python
prec, rec, thr = precision_recall_curve(y_valid, p_plain)
f1 = 2 * prec * rec / np.maximum(prec + rec, 1e-12)
best = int(np.argmax(f1[:-1]))
print(f'лучший порог по F1 на валидации: {thr[best]:.3f}; площадь под кривой (average precision) {average_precision_score(y_valid, p_plain):.3f}')
report('сдвиг порога, тест', plain.predict_proba(X_test[features])[:, 1], y_test, thr[best])

plt.figure(figsize=(5, 3.5))
plt.plot(rec, prec)
plt.axhline(y_valid.mean(), ls='--', c='gray', label='угадывание: доля гибридов')
plt.xlabel('полнота')
plt.ylabel('точность')
plt.legend()
plt.title('Кривая «точность — полнота» на валидации')
plt.show()
```

Лучший по F1 порог — 0,127, вчетверо ниже привычного. На тесте он даёт F1 0,26: модель находит 40 % гибридов, и каждая пятая метка верна. Веса, дублирование и сдвиг порога — три способа двигаться вдоль одной и той же кривой. Где на ней остановиться, решает цена ошибок, а не формула.

Площадь под этой кривой — **average precision** — при редком классе честнее AUC. Угадывание даёт здесь не 0,5, а долю гибридов, 0,056. Модель получила 0,16: лучше угадывания, но далеко до хорошего.

## Утечка через дублирование

Если продублировать гибриды до разбиения на части, копии одной и той же машины попадут и в обучение, и в проверку:

```python
Xall, yall = cars[features], y
pos_all, neg_all = np.where(yall == 1)[0], np.where(yall == 0)[0]
idx_all = np.concatenate([np.arange(len(yall)), rng.choice(pos_all, size=len(neg_all) - len(pos_all), replace=True)])
Xb_tr, Xb_te, yb_tr, yb_te = train_test_split(Xall.iloc[idx_all], yall.iloc[idx_all], test_size=0.2, random_state=42, stratify=yall.iloc[idx_all])
leaky = make_pipeline(StandardScaler(), LogisticRegression()).fit(Xb_tr, yb_tr)
pred = leaky.predict(Xb_te)
print(f'«проверка» после дублирования: точность {precision_score(yb_te, pred):.3f}, полнота {recall_score(yb_te, pred):.3f}')
```

Точность 0,69 вместо честных 0,12. Во-первых, проверочная часть сбалансирована искусственно — в ней половина гибридов вместо 5,6 %. Во-вторых, многие её гибриды — копии обучающих. Это утечка из урока 5.4: проверка видит то, что было в обучении. Правило одно: сначала разбиение, потом любые изменения обучающей части.

## Признаки важнее весов

Ни один способ выше не сделал модель лучше — они только выбирали точку на одной кривой. Лучше модель делают признаки. Добавим марку и модель машины:

```python
rich = make_pipeline(
    make_column_transformer((StandardScaler(), features), (OneHotEncoder(handle_unknown='ignore'), ['Make', 'Model'])),
    LogisticRegression(max_iter=3000)).fit(X_train, y_train)
p_rich = rich.predict_proba(X_valid)[:, 1]
report('с маркой и моделью', p_rich)
print(f'average precision: было {average_precision_score(y_valid, p_plain):.3f}, стало {average_precision_score(y_valid, p_rich):.3f}')
print('самые частые гибриды:', cars[cars['Fuel_type'] == 'Hybrid']['Model'].value_counts().head(4).to_dict())
```

AUC вырос с 0,79 до 0,98, average precision — с 0,16 до 0,75. Даже при пороге 0,5 модель находит 60 % гибридов, и 81 % её меток верны. Многие гибриды — это несколько моделей: Prius, Auris, Fusion. По году и цене гибрид не отличить, а по названию модели — легко. Сначала ищут признаки, которые отличают редкий класс, а веса и порог настраивают потом.

## Типичные ошибки

:::mistake Радоваться высокой доле верных при редком классе
94 % верных у модели, которая не нашла ни одного гибрида. При дисбалансе сравнивайте с ответом «всегда частый класс» и смотрите на полноту и точность.
:::

:::mistake Дублировать или прореживать до разбиения
Копии попадают в проверку, и оценка взлетает: 0,69 вместо 0,12. Меняйте только обучающую часть, а валидацию и тест оставляйте с настоящей долей класса.
:::

:::mistake Ждать, что веса классов улучшат модель
Веса, дублирование и сдвиг порога меняют баланс полноты и точности, но не качество упорядочения — AUC почти не меняется. Модель улучшают признаки.
:::

## Мини-квиз

```quiz
- q: Гибридов 5,6 %. Модель верна в 94,2 % случаев. Что можно сказать?
  options:
    - Ничего хорошего — ответ «гибридов нет» верен в 94,4 % случаев; нужно смотреть полноту
    - Модель отличная — почти 95 % верных
    - Модель находит 94 % гибридов
  answer: 0
  explain: При редком классе доля верных почти целиком определяется частым классом.
- q: Что делает class_weight='balanced'?
  options:
    - Делает ошибку на редком классе дороже — полнота растёт, точность падает
    - Добавляет в данные новые гибриды
    - Повышает AUC модели
  answer: 0
  explain: Веса сдвигают вероятности в пользу редкого класса; упорядочение и AUC почти не меняются.
- q: Когда можно дублировать редкий класс?
  options:
    - Только в обучающей части, после разбиения
    - До разбиения на части — так проще
    - В тестовой части, чтобы классы были поровну
  answer: 0
  explain: Иначе копии попадут в проверку и оценка станет нечестной — это утечка.
- q: Что подняло average precision с 0,16 до 0,75?
  options:
    - Новые признаки — марка и модель машины
    - Веса классов
    - Порог 0,127
  answer: 0
  explain: Веса и порог выбирают точку на кривой; поднять саму кривую могут только признаки или другая модель.
```

## Что запомнить

- При несбалансированных классах доля верных обманывает: сравнивайте с ответом «всегда частый класс», смотрите полноту, точность, F1 и average precision.
- Порог 0,5 придуман для равных классов. При редком классе модель с ним может не найти никого.
- Веса классов, дублирование, прореживание и сдвиг порога покупают полноту ценой точности; AUC они почти не меняют.
- Любые изменения выборки — только в обучающей части после разбиения; разбиение — со stratify.
- Лучше модель делают признаки, отличающие редкий класс, а не балансировка.
