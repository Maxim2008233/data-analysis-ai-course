# Эталонное «сильное» решение соревнования «Оценка цены автомобиля» — только для проверки контента
# (scripts/validate-content.ts): оно должно проходить формат и обгонять baseline. Ученикам не показывается.
import numpy as np
import pandas as pd
from lightgbm import LGBMRegressor

train = pd.read_csv('competition_cars_train.csv')
test = pd.read_csv('competition_cars_test.csv')


def parse(df):
    out = df.copy()
    engine = out['Engine'].astype(str)
    out['Turbo'] = engine.str.contains('Turbo').astype(int)
    out['Engine'] = engine.str.extract(r'(\d+\.?\d*)')[0].astype(float)
    out['Distance'] = out['Distance'].str.extract(r'(\d+)')[0].astype(float)
    return out


tr = parse(train)
te = parse(test)
tr = tr.drop_duplicates(subset=[c for c in tr.columns if c != 'ID'])
tr = tr[tr['Price'].between(1000, 500000)]

cats = ['Make', 'Model', 'Style', 'Fuel', 'Transmission', 'Drive', 'Wheel', 'Color']
nums = ['Year', 'Engine', 'Turbo', 'Distance', 'Cylinders']
for c in cats:
    levels = sorted(tr[c].dropna().unique())
    tr[c] = pd.Categorical(tr[c], categories=levels)
    te[c] = pd.Categorical(te[c].where(te[c].isin(levels)), categories=levels)

model = LGBMRegressor(n_estimators=1000, learning_rate=0.05, objective='l1', random_state=42, verbosity=-1, n_jobs=1)
model.fit(tr[cats + nums], np.log(tr['Price']))
submission = pd.DataFrame({'ID': te['ID'], 'Predict': np.exp(model.predict(te[cats + nums]))})
