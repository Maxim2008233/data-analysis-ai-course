# -*- coding: utf-8 -*-
"""Модели запросов и ответов GigaChat API — те же имена и поля, что в библиотеке gigachat.

Здесь это простые классы: их можно создавать, читать поля и превращать в словарь (`.dict()`), как в настоящей
библиотеке. Отправлять запросы учебная версия не умеет — см. gigachat.GigaChat.
"""
import json
from enum import Enum

__all__ = ["MessagesRole", "Messages", "FunctionCall", "Function", "FunctionParameters", "Chat",
           "Usage", "Choices", "ChatCompletion"]


class MessagesRole(str, Enum):
    """Кто «говорит»: system — инструкция модели, user — человек, assistant — модель, function — результат функции."""
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    FUNCTION = "function"

    def __str__(self):
        return self.value


def _plain(value, exclude_none):
    if isinstance(value, _Model):
        return value.dict(exclude_none=exclude_none)
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, list):
        return [_plain(v, exclude_none) for v in value]
    if isinstance(value, dict):
        return {k: _plain(v, exclude_none) for k, v in value.items() if not (exclude_none and v is None)}
    return value


class _Model:
    _fields = {}

    def __init__(self, **kwargs):
        unknown = set(kwargs) - set(self._fields)
        if unknown:
            raise TypeError("%s: неизвестные поля %s. Допустимые: %s" % (
                type(self).__name__, ", ".join(sorted(unknown)), ", ".join(self._fields)))
        for name, default in self._fields.items():
            if name not in kwargs and default is _REQUIRED:
                raise TypeError("%s: не задано обязательное поле «%s»." % (type(self).__name__, name))
            value = kwargs.get(name, default)
            setattr(self, name, list(value) if isinstance(value, list) else value)

    def dict(self, exclude_none=False):
        out = {}
        for name in self._fields:
            v = getattr(self, name)
            if exclude_none and v is None:
                continue
            out[name] = _plain(v, exclude_none)
        return out

    model_dump = dict

    def json(self, exclude_none=True, ensure_ascii=False, **kwargs):
        return json.dumps(self.dict(exclude_none=exclude_none), ensure_ascii=ensure_ascii, **kwargs)

    def __repr__(self):
        parts = []
        for name in self._fields:
            v = getattr(self, name)
            if v is None:
                continue
            if isinstance(v, Enum):
                v = v.value
            text = repr(v)
            if len(text) > 80:
                text = text[:77] + "...'"
            parts.append("%s=%s" % (name, text))
        return "%s(%s)" % (type(self).__name__, ", ".join(parts))

    def __eq__(self, other):
        return type(self) is type(other) and self.dict() == other.dict()


_REQUIRED = object()


class FunctionCall(_Model):
    """Вызов функции, который предложила модель: имя и аргументы-словарь."""
    _fields = {"name": _REQUIRED, "arguments": None}


class Messages(_Model):
    """Одно сообщение диалога."""
    _fields = {"role": _REQUIRED, "content": "", "function_call": None, "name": None}

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        role = self.role
        if isinstance(role, str) and not isinstance(role, MessagesRole):
            try:
                self.role = MessagesRole(role)
            except ValueError:
                raise ValueError("Неизвестная роль «%s». Роли: system, user, assistant, function." % role)
        if isinstance(self.function_call, dict):
            self.function_call = FunctionCall(**self.function_call)


class FunctionParameters(_Model):
    """Описание аргументов функции в стиле JSON Schema."""
    _fields = {"type": "object", "properties": None, "required": None}


class Function(_Model):
    """Функция, которую модели разрешено вызвать: имя, описание и аргументы."""
    _fields = {"name": _REQUIRED, "description": None, "parameters": None}


class Chat(_Model):
    """Весь запрос к модели: история сообщений и параметры генерации."""
    _fields = {"messages": _REQUIRED, "model": None, "temperature": None, "top_p": None, "max_tokens": None,
               "repetition_penalty": None, "stream": None, "update_interval": None,
               "functions": None, "function_call": None}

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        msgs = []
        for m in self.messages:
            msgs.append(Messages(**m) if isinstance(m, dict) else m)
        self.messages = msgs
        if self.temperature is not None and not (0 <= float(self.temperature) <= 2):
            raise ValueError("temperature должна быть от 0 до 2, а задано %s." % self.temperature)
        if self.max_tokens is not None and int(self.max_tokens) <= 0:
            raise ValueError("max_tokens должно быть положительным, а задано %s." % self.max_tokens)


class Usage(_Model):
    """Сколько токенов ушло на запрос и на ответ."""
    _fields = {"prompt_tokens": None, "completion_tokens": None, "total_tokens": None}


class Choices(_Model):
    """Один вариант ответа: сообщение модели и причина остановки (stop, length, function_call)."""
    _fields = {"message": _REQUIRED, "index": 0, "finish_reason": None}


class ChatCompletion(_Model):
    """Ответ API: варианты ответа (обычно один), модель и расход токенов."""
    _fields = {"choices": _REQUIRED, "created": None, "model": None, "usage": None, "object": "chat.completion"}
