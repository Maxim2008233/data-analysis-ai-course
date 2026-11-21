# -*- coding: utf-8 -*-
"""Шаблоны промптов: PromptTemplate (текст с переменными), ChatPromptTemplate (список сообщений с переменными),
FewShotPromptTemplate (примеры + вопрос) и MessagesPlaceholder (место для истории диалога)."""
import string

from ..messages import BaseMessage, HumanMessage, ROLE_CLASSES
from ..runnables import Runnable

__all__ = ["PromptTemplate", "ChatPromptTemplate", "FewShotPromptTemplate", "MessagesPlaceholder",
           "StringPromptValue", "ChatPromptValue"]


def _variables(template):
    names = []
    for _, field, _, _ in string.Formatter().parse(template):
        if field is not None and field != "":
            base = field.split(".")[0].split("[")[0]
            if base not in names:
                names.append(base)
    return names


def _check(kind, expected, values):
    missing = [v for v in expected if v not in values]
    if missing:
        raise KeyError("Input to %s is missing variables %s.  Expected: %s Received: %s" % (
            kind, set(missing), expected, list(values)))


class StringPromptValue:
    """Готовый промпт-строка."""

    def __init__(self, text):
        self.text = text

    def to_string(self):
        return self.text

    def to_messages(self):
        return [HumanMessage(content=self.text)]

    def __repr__(self):
        return "StringPromptValue(text=%r)" % self.text


class ChatPromptValue:
    """Готовый промпт-список сообщений."""

    def __init__(self, messages):
        self.messages = list(messages)

    def to_messages(self):
        return list(self.messages)

    def to_string(self):
        names = {"system": "System", "human": "Human", "ai": "AI", "function": "Function", "tool": "Tool"}
        return "\n".join("%s: %s" % (names.get(m.type, m.type), m.content) for m in self.messages)

    def __repr__(self):
        return "ChatPromptValue(messages=%r)" % self.messages


class PromptTemplate(Runnable):
    """Текст с переменными в фигурных скобках: PromptTemplate.from_template('Вопрос: {question}')."""

    def __init__(self, template, input_variables=None, partial_variables=None, **kwargs):
        self.template = template
        self.partial_variables = dict(partial_variables or {})
        found = _variables(template)
        self.input_variables = list(input_variables) if input_variables is not None else [
            v for v in found if v not in self.partial_variables]

    @classmethod
    def from_template(cls, template, **kwargs):
        return cls(template=template, **kwargs)

    def format(self, **kwargs):
        values = {**self.partial_variables, **kwargs}
        _check("PromptTemplate", self.input_variables, values)
        return self.template.format(**values)

    def partial(self, **kwargs):
        return PromptTemplate(self.template, partial_variables={**self.partial_variables, **kwargs})

    def invoke(self, input, config=None):
        if not isinstance(input, dict):
            if len(self.input_variables) == 1:
                input = {self.input_variables[0]: input}
            else:
                raise TypeError("Шаблону нужен словарь значений переменных %s." % self.input_variables)
        return StringPromptValue(self.format(**input))

    def __repr__(self):
        return "PromptTemplate(input_variables=%r, template=%r)" % (self.input_variables, self.template)


class MessagesPlaceholder:
    """Место в ChatPromptTemplate, куда при вызове подставляется список сообщений — например, история диалога."""

    def __init__(self, variable_name, optional=False):
        self.variable_name = variable_name
        self.optional = optional


class ChatPromptTemplate(Runnable):
    """Шаблон списка сообщений: ChatPromptTemplate.from_messages([('system', '...'), ('human', '{question}')])."""

    def __init__(self, messages):
        self.parts = []
        for m in messages:
            if isinstance(m, (BaseMessage, MessagesPlaceholder)):
                self.parts.append(m)
            elif isinstance(m, tuple) and len(m) == 2:
                role, template = m
                if role == "placeholder":
                    self.parts.append(MessagesPlaceholder(template.strip("{}"), optional=True))
                    continue
                if role not in ROLE_CLASSES:
                    raise ValueError("Неизвестная роль «%s». Роли: system, human (user), ai (assistant)." % role)
                self.parts.append((ROLE_CLASSES[role], template))
            else:
                raise TypeError("Сообщение шаблона — кортеж (роль, текст), сообщение или MessagesPlaceholder.")
        names = []
        for p in self.parts:
            if isinstance(p, tuple):
                names += [v for v in _variables(p[1]) if v not in names]
            elif isinstance(p, MessagesPlaceholder) and not p.optional and p.variable_name not in names:
                names.append(p.variable_name)
        self.input_variables = names

    @classmethod
    def from_messages(cls, messages):
        return cls(messages)

    @classmethod
    def from_template(cls, template):
        return cls([("human", template)])

    def format_messages(self, **kwargs):
        _check("ChatPromptTemplate", self.input_variables, kwargs)
        out = []
        for p in self.parts:
            if isinstance(p, BaseMessage):
                out.append(p)
            elif isinstance(p, MessagesPlaceholder):
                value = kwargs.get(p.variable_name, [])
                if not isinstance(value, list):
                    raise TypeError("В MessagesPlaceholder «%s» нужен список сообщений." % p.variable_name)
                out.extend(value)
            else:
                cls_, template = p
                out.append(cls_(content=template.format(**kwargs)))
        return out

    def invoke(self, input, config=None):
        if not isinstance(input, dict):
            if len(self.input_variables) == 1:
                input = {self.input_variables[0]: input}
            else:
                raise TypeError("Шаблону нужен словарь значений переменных %s." % self.input_variables)
        return ChatPromptValue(self.format_messages(**input))

    def __repr__(self):
        return "ChatPromptTemplate(input_variables=%r, messages=%d)" % (self.input_variables, len(self.parts))


class FewShotPromptTemplate(Runnable):
    """Промпт с примерами: prefix, затем examples через example_prompt, затем suffix (через example_separator)."""

    def __init__(self, examples, example_prompt, suffix, input_variables=None, prefix="", example_separator="\n\n",
                 **kwargs):
        self.examples = list(examples)
        self.example_prompt = example_prompt
        self.suffix = suffix
        self.prefix = prefix
        self.example_separator = example_separator
        self.input_variables = list(input_variables) if input_variables is not None else [
            v for v in _variables(prefix) + _variables(suffix)]

    def format(self, **kwargs):
        _check("FewShotPromptTemplate", self.input_variables, kwargs)
        shots = [self.example_prompt.format(**ex) for ex in self.examples]
        pieces = [self.prefix.format(**kwargs)] if self.prefix else []
        pieces += shots + [self.suffix.format(**kwargs)]
        return self.example_separator.join(pieces)

    def invoke(self, input, config=None):
        return StringPromptValue(self.format(**input))
