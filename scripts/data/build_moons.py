# Данные «два полумесяца» для урока 8.7 — те же параметры, что в Workshops/08_Neural_Networks_Intro.ipynb:
# make_moons(n_samples=1000, noise=0.25, random_state=100). Координаты округлены до 4 знаков.
import pandas as pd
from sklearn.datasets import make_moons

X, y = make_moons(n_samples=1000, noise=0.25, random_state=100)
moons = pd.DataFrame({'x1': X[:, 0].round(4), 'x2': X[:, 1].round(4), 'label': y})
moons.to_csv('moons.csv', index=False)
print('moons.csv:', moons.shape, 'классы:', moons['label'].value_counts().sort_index().to_dict())
