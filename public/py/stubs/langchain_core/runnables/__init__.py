# -*- coding: utf-8 -*-
"""Runnable — всё, что умеет invoke(вход) → выход. Оператор | собирает из них цепочку (RunnableSequence)."""

__all__ = ["Runnable", "RunnableLambda", "RunnableSequence"]


def coerce(obj):
    if isinstance(obj, Runnable):
        return obj
    if callable(obj):
        return RunnableLambda(obj)
    raise TypeError("В цепочку можно ставить шаблоны, модели, парсеры и функции, а получено %s." % type(obj).__name__)


class Runnable:
    def invoke(self, input, config=None):
        raise NotImplementedError

    def batch(self, inputs, config=None):
        """invoke для каждого входа по очереди — список выходов в том же порядке."""
        return [self.invoke(x) for x in inputs]

    def __or__(self, other):
        return RunnableSequence(self, coerce(other))

    def __ror__(self, other):
        return RunnableSequence(coerce(other), self)


class RunnableLambda(Runnable):
    """Обычная функция как шаг цепочки."""

    def __init__(self, func):
        self.func = func

    def invoke(self, input, config=None):
        return self.func(input)

    def __repr__(self):
        return "RunnableLambda(%s)" % getattr(self.func, "__name__", "func")


class RunnableSequence(Runnable):
    """Цепочка шагов: выход каждого шага — вход следующего."""

    def __init__(self, *steps):
        flat = []
        for s in steps:
            flat.extend(s.steps if isinstance(s, RunnableSequence) else [s])
        self.steps = flat

    @property
    def first(self):
        return self.steps[0]

    @property
    def last(self):
        return self.steps[-1]

    def invoke(self, input, config=None):
        value = input
        for step in self.steps:
            value = step.invoke(value)
        return value

    def __repr__(self):
        return " | ".join(type(s).__name__ for s in self.steps)
