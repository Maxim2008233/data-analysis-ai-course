# -*- coding: utf-8 -*-
"""Браузерная (учебная) версия библиотеки gigachat.

Настоящему GigaChat нужен ключ авторизации, а ключи нельзя хранить в коде сайта: их увидел бы любой.
Поэтому учебная версия не отправляет запросы. Она воспроизводит ответы GigaChat, сохранённые в ноутбуке курса
Workshops/2025/06_PromptEng.ipynb, — для тех же запросов, что в ноутбуке (файл gigachat_notebook.json).
Модели запроса (Chat, Messages, Function…) — те же, что в библиотеке: их можно собирать и проверять.
Свои запросы отправляйте из Colab со своим ключом.
"""
import json
import os

from .models import Chat, ChatCompletion, Choices, Messages, MessagesRole

__all__ = ["GigaChat", "BrowserLimitation"]
__version__ = "browser"

COLAB = "https://colab.research.google.com/github/MVRonkin/BasicDataAnalysisCourse/blob/main/Workshops/2025/06_PromptEng.ipynb"
COLAB_VOICE = "https://colab.research.google.com/github/MVRonkin/BasicDataAnalysisCourse/blob/main/Workshops/2025/08_%D0%93%D0%BE%D0%BB%D0%BE%D1%81%D0%BE%D0%B2%D0%BE%D0%B9_%D0%B1%D0%BE%D1%82_Colab.ipynb"
RECORDS_FILE = "gigachat_notebook.json"
VOICE_RECORDS_FILE = "voice_bot_notebook.json"  # диалог голосового бота (модуль 11)
DEFAULT_MODEL = "GigaChat"


class BrowserLimitation(RuntimeError):
    """Это действие требует настоящего GigaChat — в браузере его нет."""


_cursor = {}


def _load_records():
    records = []
    for name in (RECORDS_FILE, VOICE_RECORDS_FILE):
        if os.path.exists(name):
            with open(name, encoding="utf-8") as fh:
                records.extend(r for r in json.load(fh)["records"] if r.get("messages"))
    return records


def _key(model, messages, temperature, max_tokens):
    msgs = tuple((str(m["role"]), m["content"]) for m in messages)
    return (str(model or DEFAULT_MODEL), msgs, temperature, max_tokens)


def replay(model, messages, temperature=None, max_tokens=None):
    """Записанный ответ для такого же запроса или None. Повторные одинаковые запросы получают ответы по кругу."""
    wanted = _key(model, messages, temperature, max_tokens)
    found = [r for r in _load_records()
             if _key(r["model"], r["messages"], r.get("temperature"), r.get("max_tokens")) == wanted]
    if not found:
        return None
    k = _cursor.get(wanted, 0)
    _cursor[wanted] = k + 1
    return found[k % len(found)]


def limitation_message(model):
    if os.path.exists(VOICE_RECORDS_FILE) and not os.path.exists(RECORDS_FILE):
        source, link = VOICE_RECORDS_FILE, COLAB_VOICE
    else:
        source, link = RECORDS_FILE, COLAB
    return ("Учебная версия GigaChat не отправляет запросы: настоящему GigaChat нужен ваш ключ авторизации, а ключ "
            "нельзя хранить в коде сайта. Здесь воспроизводятся только ответы, записанные в ноутбуке курса, для тех же "
            "запросов (модель %s; список — в файле %s). Свой запрос отправьте из Colab со своим "
            "ключом: %s" % (model, source, link))


class GigaChat:
    """Клиент GigaChat. В браузере отвечает записанными ответами ноутбука курса."""

    def __init__(self, credentials=None, model=None, scope=None, verify_ssl_certs=True, timeout=None,
                 base_url=None, profanity_check=None, **kwargs):
        self.model = model or DEFAULT_MODEL
        self.scope = scope
        self.timeout = timeout

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def close(self):
        pass

    def __repr__(self):
        return "GigaChat(model='%s') — браузерная версия: воспроизводит ответы из ноутбука курса" % self.model

    @staticmethod
    def _to_chat(payload):
        if isinstance(payload, str):
            return Chat(messages=[Messages(role=MessagesRole.USER, content=payload)])
        if isinstance(payload, dict):
            return Chat(**payload)
        if isinstance(payload, Chat):
            return payload
        raise TypeError("chat() принимает строку, словарь или Chat, а получено %s." % type(payload).__name__)

    def chat(self, payload):
        """Запрос к модели: строка, словарь или Chat. Возвращает ChatCompletion."""
        chat = self._to_chat(payload)
        model = chat.model or self.model
        messages = [{"role": str(m.role), "content": m.content} for m in chat.messages]
        if chat.functions:
            raise BrowserLimitation(
                "Запросы с функциями (functions) учебная версия не воспроизводит: аргументы вызовов в ноутбуке не "
                "сохранились. Как устроен такой обмен сообщениями — в уроке 10.6; настоящий вызов — в Colab: " + COLAB)
        rec = replay(model, messages, chat.temperature, chat.max_tokens)
        if rec is None:
            raise BrowserLimitation(limitation_message(model))
        message = Messages(role=MessagesRole.ASSISTANT, content=rec["response"])
        return ChatCompletion(choices=[Choices(message=message, index=0, finish_reason=rec.get("finish_reason") or "stop")],
                              model=model)

    def get_models(self):
        raise BrowserLimitation("Список моделей знает только сервер GigaChat. Запустите код в Colab: " + COLAB)
