# Сборка данных практикума-соревнования 1 «Оценка цены автомобиля».
# Источник: Workshops/basic competitions/cars_train.csv — 9 619 объявлений с ценой
# (копия лежит в private/competitions/cars-price/source/cars_train.csv).
#
# Ответы к исходному cars_test.csv в материалах курса не опубликованы (они хранились на Kaggle),
# поэтому скрытую проверочную часть выделяем из размеченного файла:
#   1. Объявления с одинаковыми признаками образуют группу. Группа целиком попадает либо в обучающую,
#      либо в проверочную часть — иначе модель «узнавала» бы проверочные машины по их копиям в train.
#   2. 25 % групп (фиксированный seed) — проверочная часть; из каждой группы в неё идёт одна строка.
#   3. В проверочную часть входят только правдоподобные цены — от 1 000 до 500 000: объявления
#      дешевле 1 000 почти всегда содержат ошибку цены (Lexus GX 460 2015 года за 706).
#      Обучающая часть остаётся как есть: повторы, пропуски и ошибочные цены ученик чистит сам.
#
# Результат:
#   public/data/competition_cars_train.csv              — обучающая часть с ценой
#   public/data/competition_cars_test.csv               — проверочная часть без цены
#   public/data/competition_cars_sample_submission.csv  — пример файла с прогнозами
#   private/competitions/cars-price/answers.json        — ответы проверочной части (только для сервера)
# Запуск: npm run data:build (выполняется в Pyodide, как и код на сайте).
import json
import numpy as np
import pandas as pd

raw = pd.read_csv('cars_train.csv')
features = ['Make', 'Model', 'Year', 'Style', 'Fuel', 'Engine', 'Distance', 'Cylinders',
            'Transmission', 'Drive', 'Wheel', 'Color']
MIN_PRICE, MAX_PRICE = 1_000, 500_000
TEST_SHARE = 0.25

key = raw[features].astype(object).fillna('').astype(str).agg('|'.join, axis=1)
groups = np.asarray(pd.unique(key), dtype=object)
rng = np.random.default_rng(20261112)
test_groups = set(rng.choice(groups, size=round(TEST_SHARE * len(groups)), replace=False))
in_test = key.isin(test_groups).to_numpy()

train = raw.loc[~in_test].copy()
test_all = raw.loc[in_test].assign(group=key[in_test].to_numpy())
test_unique = test_all.drop_duplicates('group')
test = test_unique[test_unique['Price'].between(MIN_PRICE, MAX_PRICE)].copy()

# перемешиваем и нумеруем заново: ID — просто номер строки в своей части
train = train.sample(frac=1, random_state=1).reset_index(drop=True)
test = test.sample(frac=1, random_state=2).reset_index(drop=True)
train['ID'] = np.arange(1, len(train) + 1)
test['ID'] = np.arange(1, len(test) + 1)

train[['Price'] + features + ['ID']].to_csv('competition_cars_train.csv', index=False)
test[features + ['ID']].to_csv('competition_cars_test.csv', index=False)
sample = pd.DataFrame({'ID': test['ID'], 'Predict': float(train['Price'].median())})
sample.to_csv('competition_cars_sample_submission.csv', index=False)
with open('answers.json', 'w', encoding='utf-8') as f:
    json.dump({'competition': 'cars-price', 'ids': test['ID'].tolist(), 'prices': test['Price'].astype(int).tolist()}, f)

print(f'Исходных объявлений: {len(raw)}, групп одинаковых признаков: {len(groups)}')
print(f'Обучающая часть: {len(train)} строк (с повторами, пропусками и всеми ценами)')
print(f'Проверочная часть: групп {len(test_groups)}, по строке на группу {len(test_unique)}, '
      f'с ценой {MIN_PRICE}–{MAX_PRICE}: {len(test)}')
