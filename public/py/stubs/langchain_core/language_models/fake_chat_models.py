# -*- coding: utf-8 -*-
"""Тестовые модели: отвечают заранее заданными ответами по очереди (по кругу).

FakeListChatModel(responses=['текст', ...]) возвращает AIMessage с этими текстами;
FakeMessagesListChatModel(responses=[AIMessage(...), ...]) — готовые сообщения, в том числе с вызовами
инструментов (tool_calls).

Так в настоящей работе проверяют цепочки и агентов без обращения к платной модели: шаблон, разбор ответа и логика
программы проверяются на известных ответах, а потом тестовую модель заменяют настоящей.
"""
from ..messages import AIMessage, BaseMessage, HumanMessage
from ..runnables import Runnable

__all__ = ["BaseChatModel", "FakeListChatModel", "FakeMessagesListChatModel"]


def to_messages(input):
    """Вход чат-модели → список сообщений: строка, промпт-значение или список сообщений."""
    if isinstance(input, str):
        return [HumanMessage(content=input)]
    if hasattr(input, "to_messages"):
        return input.to_messages()
    if isinstance(input, list) and all(isinstance(m, BaseMessage) for m in input):
        return list(input)
    if isinstance(input, list) and all(isinstance(m, tuple) and len(m) == 2 for m in input):
        from ..messages import ROLE_CLASSES
        return [ROLE_CLASSES[r](content=c) for r, c in input]
    if isinstance(input, list) and all(isinstance(m, dict) and "role" in m and "content" in m for m in input):
        from ..messages import ROLE_CLASSES
        out = []
        for m in input:
            if m["role"] not in ROLE_CLASSES:
                raise ValueError("Неизвестная роль «%s». Роли: system, user, assistant, function." % m["role"])
            out.append(ROLE_CLASSES[m["role"]](content=m["content"]))
        return out
    raise TypeError("Чат-модели нужна строка, список сообщений (объектов или словарей {'role', 'content'}) или промпт из шаблона, а получено %s." % type(input).__name__)


class BaseChatModel(Runnable):
    def _respond(self, messages):
        raise NotImplementedError

    def invoke(self, input, config=None, **kwargs):
        return self._respond(to_messages(input))

    def __call__(self, messages, **kwargs):
        return self.invoke(messages)

    def bind_tools(self, tools, **kwargs):
        raise NotImplementedError(
            "У %s нет bind_tools: тестовая модель не читает описания инструментов, а отвечает заготовленными "
            "сообщениями. Вызовы инструментов задайте прямо в ответах: FakeMessagesListChatModel(responses=["
            "AIMessage(content='', tool_calls=[{'name': ..., 'args': {...}, 'id': ...}]), ...]). bind_tools есть у "
            "настоящих моделей — например, у GigaChat из langchain_gigachat в Colab." % type(self).__name__)


class FakeListChatModel(BaseChatModel):
    """FakeListChatModel(responses=['ответ 1', 'ответ 2']): i-й вызов получает i-й ответ, после последнего — снова первый."""

    def __init__(self, responses, sleep=None, i=0, **kwargs):
        if not responses:
            raise ValueError("Нужен хотя бы один ответ: FakeListChatModel(responses=['...']).")
        self.responses = list(responses)
        self.i = i
        self.calls = []

    def _respond(self, messages):
        self.calls.append(messages)
        text = self.responses[self.i % len(self.responses)]
        self.i = (self.i + 1) % len(self.responses)
        return AIMessage(content=text)

    def __repr__(self):
        return "FakeListChatModel(responses=%d)" % len(self.responses)


class FakeMessagesListChatModel(BaseChatModel):
    """FakeMessagesListChatModel(responses=[AIMessage(...), ...]): возвращает готовые сообщения по очереди, по кругу.

    Подходит для проверки агента: в ответах можно задать вызовы инструментов (tool_calls), как у настоящей модели.
    """

    def __init__(self, responses, sleep=None, i=0, **kwargs):
        if not responses:
            raise ValueError("Нужен хотя бы один ответ: FakeMessagesListChatModel(responses=[AIMessage(...)]).")
        bad = [type(r).__name__ for r in responses if not isinstance(r, BaseMessage)]
        if bad:
            raise TypeError("FakeMessagesListChatModel отвечает готовыми сообщениями (AIMessage), а в responses есть %s. "
                            "Для текстовых ответов есть FakeListChatModel." % bad[0])
        self.responses = list(responses)
        self.i = i
        self.calls = []

    def _respond(self, messages):
        self.calls.append(messages)
        msg = self.responses[self.i % len(self.responses)]
        self.i = (self.i + 1) % len(self.responses)
        return msg

    def __repr__(self):
        return "FakeMessagesListChatModel(responses=%d)" % len(self.responses)
