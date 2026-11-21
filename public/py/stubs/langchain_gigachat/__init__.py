# -*- coding: utf-8 -*-
"""Браузерная (учебная) версия langchain_gigachat: чат-модель GigaChat для цепочек LangChain.

Как и учебная gigachat, она не отправляет запросы (нужен ключ), а воспроизводит ответы из ноутбуков курса для тех же
сообщений. В цепочках для проверки используйте langchain_core.language_models.FakeListChatModel.
"""
from gigachat import BrowserLimitation
from .chat_models import GigaChat

__all__ = ["GigaChat", "GigaChatBrowserLimitation"]
__version__ = "browser"
GigaChatBrowserLimitation = BrowserLimitation
