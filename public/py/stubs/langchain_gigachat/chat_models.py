# -*- coding: utf-8 -*-
"""Чат-модель GigaChat для цепочек LangChain (учебная версия langchain_gigachat.chat_models).

Как и учебная gigachat, она не отправляет запросы (нужен ключ), а воспроизводит ответы из ноутбуков курса для тех же
сообщений. В цепочках и агентах для проверки используйте тестовые модели из langchain_core.language_models.
"""
from gigachat import BrowserLimitation, COLAB, limitation_message, replay
from langchain_core.language_models.fake_chat_models import BaseChatModel
from langchain_core.messages import AIMessage, to_role
from langchain_core.runnables import Runnable

__all__ = ["GigaChat"]


class GigaChat(BaseChatModel):
    def __init__(self, model=None, credentials=None, verify_ssl_certs=True, streaming=False, temperature=None,
                 max_tokens=None, scope=None, timeout=None, **kwargs):
        self.model = model or "GigaChat"
        self.temperature = temperature
        self.max_tokens = max_tokens

    def _respond(self, messages):
        plain = [{"role": to_role(m), "content": m.content} for m in messages]
        rec = replay(self.model, plain, self.temperature, self.max_tokens)
        if rec is None:
            raise BrowserLimitation(limitation_message(self.model))
        return AIMessage(content=rec["response"])

    def bind_tools(self, tools, tool_choice=None, **kwargs):
        """Модель с инструментами: в настоящем GigaChat описания инструментов уходят в запрос вместе с сообщениями."""
        return _ToolBoundGigaChat(self, list(tools))

    def __repr__(self):
        return "GigaChat(model='%s') — браузерная версия langchain_gigachat" % self.model


class _ToolBoundGigaChat(Runnable):
    def __init__(self, llm, tools):
        self.llm, self.tools = llm, tools

    def invoke(self, input, config=None, **kwargs):
        names = ", ".join(getattr(t, "name", getattr(t, "__name__", "?")) for t in self.tools)
        raise BrowserLimitation(
            "Запросы с инструментами (%s) учебная версия GigaChat не воспроизводит: в ноутбуках курса таких ответов "
            "нет, а настоящему GigaChat нужен ваш ключ. В браузере проверяйте агента на тестовой модели "
            "FakeMessagesListChatModel, а с настоящей моделью запускайте в Colab: %s" % (names, COLAB))

    def __repr__(self):
        names = ", ".join(getattr(t, "name", getattr(t, "__name__", "?")) for t in self.tools)
        return "GigaChat(model='%s').bind_tools([%s])" % (self.llm.model, names)
