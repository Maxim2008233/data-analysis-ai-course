# Сборка cars_processed.csv — результат модуля 2 (лабораторная 02 «Pandas: Cars ETL»).
# Повторяет шаги ноутбука: точные повторы → полные записи → учебная область анализа → source_row_id →
# переименование → Age, km_year → Transmission (map) → km_year_cat (apply) → редкие марки в Rare.
# Запуск: npm run data:build (выполняется в Pyodide, как и код на сайте).
import numpy as np
import pandas as pd

raw = pd.read_csv('cars.csv')
df = raw.copy()
log = []

def step(name, new_df):
    log.append({'Этап': name, 'До': len(df), 'После': len(new_df), 'Убрано': len(df) - len(new_df)})
    return new_df

df = step('Удаление точных повторов', df.drop_duplicates().copy())
df = step('Отбор полных записей', df.dropna().copy())

MIN_YEAR, MAX_YEAR = 1951, 2021
MIN_ENGINE, MAX_ENGINE = 200, 5000
MIN_PRICE, MAX_PRICE = 101, 500_000
MAX_DISTANCE, MIN_DISTANCE_OLDER = 1_000_000, 1100
in_scope = (
    df['Year'].between(MIN_YEAR, MAX_YEAR)
    & df['Distance'].between(0, MAX_DISTANCE)
    & df['Engine_capacity(cm3)'].between(MIN_ENGINE, MAX_ENGINE)
    & df['Price(euro)'].between(MIN_PRICE, MAX_PRICE)
    & ~((df['Year'] < MAX_YEAR) & (df['Distance'] < MIN_DISTANCE_OLDER))
)
df = step('Учебная область анализа', df.loc[in_scope].copy())

df['source_row_id'] = df.index
df = df.reset_index(drop=True)
df = df.rename(columns={'Engine_capacity(cm3)': 'Engine', 'Price(euro)': 'Price'})

REFERENCE_YEAR = 2022
df['Age'] = REFERENCE_YEAR - df['Year']
df['km_year'] = df['Distance'] / df['Age']
df['Transmission'] = df['AutoTransmission'].map({True: 'Automatic', False: 'Manual'})

def km_year_category(value):
    if pd.isna(value):
        return np.nan
    if value <= 10_000:
        return 'Small'
    if value <= 30_000:
        return 'Medium'
    return 'Large'

df['km_year_cat'] = df['km_year'].apply(km_year_category)

RARE_SHARE = 0.01
make_share = df['Make'].value_counts() / len(df)
rare_makes = make_share.loc[make_share <= RARE_SHARE].index
df['Make_original'] = df['Make']
df.loc[df['Make'].isin(rare_makes), 'Make'] = 'Rare'

output_columns = [
    'Make', 'Model', 'Year', 'Style', 'Distance', 'Engine', 'Fuel_type',
    'AutoTransmission', 'Price', 'Age', 'km_year', 'Transmission',
    'km_year_cat', 'Make_original', 'source_row_id',
]
processed = df[output_columns].copy()
processed.to_csv('cars_processed.csv', index=False)
pd.DataFrame(log).to_csv('cars_preprocessing_log.csv', index=False)
print('cars_processed.csv:', processed.shape)
print(pd.DataFrame(log).to_string(index=False))
