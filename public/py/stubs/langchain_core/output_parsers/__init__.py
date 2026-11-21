# -*- coding: utf-8 -*-
"""Разбор ответа модели: StrOutputParser (текст), JsonOutputParser (JSON), CommaSeparatedListOutputParser (список)."""
import json
import re

from ..exceptions import OutputParserException
from ..messages import BaseMessage
from ..runnables import Runnable

__all__ = ["StrOutputParser", "JsonOutputParser", "CommaSeparatedListOutputParser"]


def _text(value):
    if isinstance(value, BaseMessage):
        return value.content
    if isinstance(value, str):
        return value
    raise TypeError("Парсеру нужен ответ модели (сообщение или строка), а получено %s." % type(value).__name__)


class StrOutputParser(Runnable):
    """Текст ответа модели."""

    def parse(self, text):
        return text

    def invoke(self, input, config=None):
        return self.parse(_text(input))


class JsonOutputParser(Runnable):
    """JSON из ответа модели. Понимает и JSON внутри блока ```json ... ```."""

    def parse(self, text):
        m = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
        body = (m.group(1) if m else text).strip()
        try:
            return json.loads(body)
        except json.JSONDecodeError as e:
            raise OutputParserException("Invalid json output: %s" % text, llm_output=text) from e

    def get_format_instructions(self):
        return "Верни ответ только в формате JSON, без пояснений до и после."

    def invoke(self, input, config=None):
        return self.parse(_text(input))


class CommaSeparatedListOutputParser(Runnable):
    """Список из ответа вида «a, b, c»."""

    def parse(self, text):
        return [part.strip() for part in text.strip().split(",") if part.strip()]

    def get_format_instructions(self):
        return "Your response should be a list of comma separated values, eg: `foo, bar, baz`"

    def invoke(self, input, config=None):
        return self.parse(_text(input))
