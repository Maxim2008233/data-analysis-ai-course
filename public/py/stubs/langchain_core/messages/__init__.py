# -*- coding: utf-8 -*-
"""Сообщения диалога: SystemMessage (инструкция), HumanMessage (человек), AIMessage (модель), FunctionMessage
и ToolMessage (результат функции или инструмента).

У AIMessage может быть список tool_calls — просьбы модели вызвать инструменты: имя, аргументы и номер вызова (id).
Результат инструмента возвращают сообщением ToolMessage с тем же tool_call_id — так модель понимает, на какой вызов
пришёл ответ.
"""

__all__ = ["BaseMessage", "SystemMessage", "HumanMessage", "AIMessage", "FunctionMessage", "ToolMessage", "ToolCall",
           "messages_to_dict"]


def _title(title):
    """Заголовок сообщения шириной 80 символов — как в настоящем LangChain (pretty_print)."""
    padded = " " + title + " "
    sep = "=" * ((80 - len(padded)) // 2)
    return sep + padded + (sep + "=" if len(padded) % 2 else sep)


class BaseMessage:
    type = "base"

    def __init__(self, content="", **kwargs):
        if not isinstance(content, str):
            raise TypeError("content сообщения — строка, а получено %s." % type(content).__name__)
        self.content = content
        self.additional_kwargs = kwargs.pop("additional_kwargs", {}) or {}
        self.response_metadata = kwargs.pop("response_metadata", {}) or {}
        self.name = kwargs.pop("name", None)
        self.id = kwargs.pop("id", None)
        for k, v in kwargs.items():
            setattr(self, k, v)

    @property
    def text(self):
        return self.content

    def _repr_extra(self):
        return ""

    def __repr__(self):
        extra = ", name=%r" % self.name if self.name else ""
        return "%s(content=%r%s%s)" % (type(self).__name__, self.content, extra, self._repr_extra())

    def __eq__(self, other):
        return (type(self) is type(other) and self.content == other.content and self.name == other.name
                and getattr(self, "tool_calls", None) == getattr(other, "tool_calls", None)
                and getattr(self, "tool_call_id", None) == getattr(other, "tool_call_id", None))

    def pretty_repr(self, html=False):
        title = _title(self.type.title() + " Message")
        if self.name is not None:
            title += "\nName: %s" % self.name
        return "%s\n\n%s" % (title, self.content)

    def pretty_print(self):
        print(self.pretty_repr())


class SystemMessage(BaseMessage):
    type = "system"


class HumanMessage(BaseMessage):
    type = "human"


def ToolCall(name, args, id):
    """Вызов инструмента — словарь {'name', 'args', 'id', 'type': 'tool_call'}, как в настоящем LangChain."""
    return {"name": name, "args": args, "id": id, "type": "tool_call"}


def _check_tool_call(tc, i):
    if not isinstance(tc, dict):
        raise TypeError("tool_calls — список словарей {'name', 'args', 'id'}, а элемент %d — %s."
                        % (i, type(tc).__name__))
    missing = [k for k in ("name", "args", "id") if k not in tc]
    if missing:
        raise ValueError("В вызове инструмента %d нет ключей %s: у каждого вызова есть имя инструмента (name), "
                         "аргументы (args — словарь) и номер вызова (id)." % (i, ", ".join(repr(k) for k in missing)))
    if not isinstance(tc["args"], dict):
        raise TypeError("Аргументы вызова (args) — словарь, а в вызове %d получено %s."
                        % (i, type(tc["args"]).__name__))
    return {"name": tc["name"], "args": tc["args"], "id": tc["id"], "type": "tool_call"}


class AIMessage(BaseMessage):
    type = "ai"

    def __init__(self, content="", **kwargs):
        calls = kwargs.pop("tool_calls", None) or []
        if not isinstance(calls, (list, tuple)):
            raise TypeError("tool_calls — список вызовов, а получено %s." % type(calls).__name__)
        kwargs.pop("invalid_tool_calls", None)
        super().__init__(content, **kwargs)
        self.tool_calls = [_check_tool_call(tc, i) for i, tc in enumerate(calls)]
        self.invalid_tool_calls = []

    def _repr_extra(self):
        return ", tool_calls=%r" % self.tool_calls if self.tool_calls else ""

    def pretty_repr(self, html=False):
        base = super().pretty_repr(html)
        lines = []
        if self.tool_calls:
            lines.append("Tool Calls:")
            for tc in self.tool_calls:
                lines.append("  %s (%s)" % (tc.get("name", "Tool"), tc.get("id")))
                lines.append(" Call ID: %s" % tc.get("id"))
                lines.append("  Args:")
                for arg, value in tc["args"].items():
                    lines.append("    %s: %s" % (arg, value))
        return (base.strip() + "\n" + "\n".join(lines)).strip()


class FunctionMessage(BaseMessage):
    type = "function"


class ToolMessage(BaseMessage):
    """Результат инструмента: ToolMessage(content='…', tool_call_id='номер вызова из AIMessage.tool_calls')."""
    type = "tool"

    def __init__(self, content="", **kwargs):
        if "tool_call_id" not in kwargs:
            raise TypeError("ToolMessage нужен tool_call_id — номер вызова из AIMessage.tool_calls: по нему модель "
                            "понимает, на какой вызов пришёл ответ. Пример: ToolMessage(content='243', "
                            "tool_call_id=call['id']).")
        if not isinstance(content, (str, list)):
            content = str(content)  # как в LangChain: число или другой объект превращается в строку
        if isinstance(content, list):
            content = "\n".join(str(x) for x in content)
        self.tool_call_id = str(kwargs.pop("tool_call_id"))
        self.status = kwargs.pop("status", "success")
        super().__init__(content, **kwargs)

    def _repr_extra(self):
        return ", tool_call_id=%r" % self.tool_call_id


ROLE_CLASSES = {"system": SystemMessage, "human": HumanMessage, "user": HumanMessage,
                "ai": AIMessage, "assistant": AIMessage, "function": FunctionMessage}


def messages_to_dict(messages):
    return [{"type": m.type, "data": {"content": m.content}} for m in messages]


def to_role(message):
    """Роль сообщения в терминах API чат-моделей: system, user, assistant, function."""
    return {"system": "system", "human": "user", "ai": "assistant", "function": "function", "tool": "function"}[message.type]
