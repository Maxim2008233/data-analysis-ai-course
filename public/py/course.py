# -*- coding: utf-8 -*-
"""
Готовые функции курса («заготовки»).

То, что изучалось давно и не является целью текущего задания, вынесено сюда, чтобы не держать в голове
и не переписывать каждый раз. У каждой функции указано, в каком уроке этот шаг разбирался подробно.
"""
import csv

CARS_FILE = "cars.csv"
NUMERIC_NAMES = ["Year", "Distance", "Engine_capacity(cm3)", "Price(euro)"]


def load_numeric(path=CARS_FILE):
    """Числовые столбцы cars.csv как матрица NumPy.

    Это мы делали в модуле 1, урок 1.1 «От вопроса к таблице».
    Возвращает (X, names): X — матрица (строки × 4 признака), names — названия столбцов.
    """
    import numpy as np
    with open(path, encoding="utf-8-sig", newline="") as fh:
        header = next(csv.reader(fh))
    cols = [header.index(n) for n in NUMERIC_NAMES]
    X = np.genfromtxt(path, delimiter=",", skip_header=1, usecols=cols, dtype=float, ndmin=2)
    return X, list(NUMERIC_NAMES)
