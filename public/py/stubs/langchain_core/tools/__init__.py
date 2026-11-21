# -*- coding: utf-8 -*-
"""Инструменты LangChain (учебная версия langchain_core.tools).

Декоратор @tool превращает функцию Python в инструмент агента:
- name — имя функции;
- description — её строка документации (docstring);
- args — схема аргументов в формате JSON Schema, построенная по подсказкам типов (query: str, k: int = 3).

Модель видит только имя, описание и схему; выполняет функцию программа: tool.invoke({'аргумент': значение}) или
tool.invoke(вызов из AIMessage.tool_calls) — тогда результат сразу приходит сообщением ToolMessage.
Поведение повторяет настоящий langchain_core.tools для функций с аргументами str, int, float, bool, list, dict,
Literal и Optional.
"""
import inspect
import json
import textwrap
import types
import typing

from ..messages import ToolMessage

__all__ = ["tool", "BaseTool", "StructuredTool", "ToolException", "ToolValidationError"]

_SIMPLE = {str: "string", int: "integer", float: "number", bool: "boolean", list: "array", dict: "object"}
_TYPE_RU = {"string": "строка", "integer": "целое число", "number": "число", "boolean": "True или False",
            "array": "список", "object": "словарь"}
_TRUE = {"1", "on", "t", "true", "y", "yes"}
_FALSE = {"0", "off", "f", "false", "n", "no"}


class ToolException(Exception):
    """Ошибка выполнения инструмента."""


class ToolValidationError(ValueError):
    """Аргументы не подходят к схеме инструмента (в настоящем LangChain это pydantic.ValidationError — тоже ValueError)."""


def _sorted(schema):
    """Ключи схемы по алфавиту, как у pydantic; порядок аргументов в properties сохраняется."""
    out = {}
    for key in sorted(schema):
        value = schema[key]
        if key == "properties":
            value = {name: _sorted(s) for name, s in value.items()}
        elif key in ("items", "additionalProperties") and isinstance(value, dict):
            value = _sorted(value)
        elif key == "anyOf":
            value = [_sorted(s) for s in value]
        out[key] = value
    return out


def _schema_for(annotation, where):
    if annotation is inspect.Parameter.empty or annotation is typing.Any:
        return {}
    if annotation in _SIMPLE:
        return {"items": {}, "type": "array"} if annotation is list else {"type": _SIMPLE[annotation]}
    origin = typing.get_origin(annotation)
    args = typing.get_args(annotation)
    if origin is list:
        return {"items": _schema_for(args[0], where) if args else {}, "type": "array"}
    if origin is dict:
        return {"additionalProperties": _schema_for(args[1], where), "type": "object"} if len(args) == 2 else {"type": "object"}
    if origin is typing.Literal:
        vals = list(args)
        s = {"enum": vals}
        kinds = {type(v) for v in vals}
        if len(kinds) == 1 and next(iter(kinds)) in _SIMPLE:
            s["type"] = _SIMPLE[next(iter(kinds))]
        return s
    if origin in (typing.Union, types.UnionType):
        return {"anyOf": [{"type": "null"} if a is type(None) else _schema_for(a, where) for a in args]}
    raise TypeError("Учебная версия @tool понимает аргументы типов str, int, float, bool, list, dict, Literal и "
                    "Optional, а у аргумента «%s» тип %r." % (where, annotation))


def _field_title(name):
    return name.title().replace("_", " ").strip()


def _parse_google_docstring(docstring, arg_names, error_on_invalid):
    """Разбор docstring в стиле Google: описание до «Args:», описания аргументов — строки «имя: текст» после."""
    if docstring:
        blocks = docstring.split("\n\n")
        if error_on_invalid and arg_names and (
                len(blocks) < 2 or not any(b.startswith("Args:") for b in blocks[1:])):
            raise ValueError("Found invalid Google-Style docstring. — docstring не в формате Google: нужен абзац с "
                             "описанием, пустая строка и раздел «Args:» со строками «аргумент: описание».")
        descriptors, args_block, past = [], None, False
        for block in blocks:
            if block.startswith("Args:"):
                args_block = block
                break
            if block.startswith(("Returns:", "Example:")):
                past = True
            elif not past:
                descriptors.append(block)
        description = " ".join(descriptors)
    else:
        if error_on_invalid:
            raise ValueError("Found invalid Google-Style docstring. — у функции нет docstring.")
        description, args_block = "", None
    arg_descriptions = {}
    if args_block:
        arg = None
        for line in args_block.split("\n")[1:]:
            if ":" in line:
                arg, desc = line.split(":", 1)
                arg = arg.strip()
                arg_name, _, ann = arg.partition(" ")
                if ann.startswith("(") and ann.endswith(")"):
                    arg = arg_name
                arg_descriptions[arg] = desc.strip()
            elif arg:
                arg_descriptions[arg] += " " + line.strip()
    return description, arg_descriptions


def _stringify(value):
    try:
        return json.dumps(value, ensure_ascii=False)
    except Exception:
        return str(value)


def _show(value):
    return repr(value) if not isinstance(value, str) or len(value) < 60 else repr(value[:57] + "...")


class _ArgsSchema:
    """Схема аргументов: model_json_schema() — словарь JSON Schema, как у pydantic-модели в настоящем LangChain."""

    def __init__(self, title, description, properties, required):
        self.title, self.description = title, description
        self.properties, self.required = properties, required

    def model_json_schema(self):
        s = {"properties": self.properties, "title": self.title, "type": "object"}
        if self.description:
            s["description"] = self.description
        if self.required:
            s["required"] = list(self.required)
        return _sorted(s)

    def __repr__(self):
        return "<class 'langchain_core.utils.pydantic.%s'>" % self.title


class BaseTool:
    """Общий предок инструментов: name, description, args и invoke."""
    name = ""
    description = ""
    return_direct = False


class StructuredTool(BaseTool):
    def __init__(self, name, description, func, args_schema, return_direct=False):
        self.name, self.description, self.func = name, description, func
        self.args_schema = args_schema
        self.return_direct = return_direct

    @classmethod
    def from_function(cls, func=None, name=None, description=None, return_direct=False, args_schema=None,
                      infer_schema=True, parse_docstring=False, error_on_invalid_docstring=False, **kwargs):
        if func is None or not callable(func):
            raise TypeError("Инструмент делают из функции: StructuredTool.from_function(func=моя_функция).")
        name = name or func.__name__
        params = [p for p in inspect.signature(func).parameters.values()
                  if p.name not in ("self", "cls", "run_manager", "callbacks")
                  and p.kind not in (p.VAR_POSITIONAL, p.VAR_KEYWORD)]
        try:
            hints = typing.get_type_hints(func, include_extras=True)
        except Exception:
            hints = {}
        arg_descriptions = {}
        if parse_docstring:
            desc_doc, arg_descriptions = _parse_google_docstring(
                inspect.getdoc(func), [p.name for p in params], error_on_invalid_docstring)
            if description is None:
                description = desc_doc
        if description is None:
            if not func.__doc__:
                raise ValueError("Function must have a docstring if description not provided. — у функции «%s» "
                                 "нет строки документации (docstring). Из неё модель узнаёт, что делает инструмент "
                                 "и когда его звать: добавьте \"\"\"Описание\"\"\" первой строкой тела функции или "
                                 "передайте description=..." % name)
            description = textwrap.dedent(func.__doc__).strip()
        properties, required = {}, []
        for p in params:
            ann = hints.get(p.name, p.annotation)
            note = None
            if typing.get_origin(ann) is typing.Annotated:  # Annotated[str, "описание аргумента"]
                ann, *meta = typing.get_args(ann)
                note = next((m for m in meta if isinstance(m, str)), None)
            s = dict(_schema_for(ann, p.name))
            s["title"] = _field_title(p.name)
            if p.name in arg_descriptions:
                s["description"] = arg_descriptions[p.name]
            elif note:
                s["description"] = note
            if p.default is inspect.Parameter.empty:
                required.append(p.name)
            else:
                s["default"] = p.default
            properties[p.name] = s
        schema = _ArgsSchema(name, description, properties, required)
        return cls(name, description, func, schema, return_direct)

    # --- схема и описание ---
    @property
    def args(self):
        return _sorted({"properties": self.args_schema.properties})["properties"]

    @property
    def tool_call_schema(self):
        return self.args_schema

    def __repr__(self):
        return "StructuredTool(name=%r, description=%r, args_schema=%r, func=<function %s>)" % (
            self.name, self.description, self.args_schema, getattr(self.func, "__name__", "?"))

    def __call__(self, *args, **kwargs):
        raise TypeError("Инструмент вызывают через invoke: %s.invoke({...}) — словарь аргументов или вызов из "
                        "AIMessage.tool_calls. Саму функцию можно вызвать как %s.func(...)." % (self.name, self.name))

    # --- проверка аргументов ---
    def _coerce(self, value, schema, path, errors):
        if "anyOf" in schema:
            if value is None and {"type": "null"} in schema["anyOf"]:
                return None
            for s in schema["anyOf"]:
                if s.get("type") == "null":
                    continue
                trial = []
                got = self._coerce(value, s, path, trial)
                if not trial:
                    return got
            kinds = " или ".join(_TYPE_RU.get(s.get("type"), "значение") for s in schema["anyOf"] if s.get("type") != "null")
            errors.append("%s: нужно %s или None, а передано %s" % (path, kinds, _show(value)))
            return value
        if "enum" in schema:
            if value in schema["enum"]:
                return value
            errors.append("%s: допустимые значения %s, а передано %s" % (path, schema["enum"], _show(value)))
            return value
        t = schema.get("type")
        if t is None:
            return value
        ok, out = False, value
        if t == "string":
            ok = isinstance(value, str)
        elif t == "integer":
            if isinstance(value, bool) or isinstance(value, int):
                ok, out = True, int(value)
            elif isinstance(value, float) and value.is_integer():
                ok, out = True, int(value)
            elif isinstance(value, str) and value.strip().lstrip("+-").isdigit():
                ok, out = True, int(value.strip())
        elif t == "number":
            if isinstance(value, (int, float)):
                ok, out = True, value
            elif isinstance(value, str):
                try:
                    ok, out = True, float(value)
                except ValueError:
                    ok = False
        elif t == "boolean":
            if isinstance(value, bool):
                ok = True
            elif isinstance(value, int) and value in (0, 1):
                ok, out = True, bool(value)
            elif isinstance(value, str) and value.strip().lower() in _TRUE | _FALSE:
                ok, out = True, value.strip().lower() in _TRUE
        elif t == "array":
            if isinstance(value, (list, tuple, set)):
                ok = True
                out = [self._coerce(v, schema.get("items", {}), "%s[%d]" % (path, i), errors)
                       for i, v in enumerate(value)]
        elif t == "object":
            ok = isinstance(value, dict)
        if not ok:
            errors.append("%s: нужно %s (%s), а передано %s" % (path, _TYPE_RU.get(t, t), t, _show(value)))
        return out

    def _parse_input(self, tool_input):
        props, required = self.args_schema.properties, self.args_schema.required
        if isinstance(tool_input, str):
            if not props:
                raise ToolValidationError("У инструмента «%s» нет аргументов, а передана строка %s."
                                          % (self.name, _show(tool_input)))
            tool_input = {next(iter(props)): tool_input}
        if not isinstance(tool_input, dict):
            raise ToolValidationError("Инструменту «%s» передают словарь аргументов или строку, а получено %s."
                                      % (self.name, type(tool_input).__name__))
        errors, kwargs = [], {}
        for name in required:
            if name not in tool_input:
                errors.append("%s: обязательный аргумент не передан" % name)
        for name, value in tool_input.items():
            if name in props:  # лишние ключи отбрасываются, как в LangChain
                kwargs[name] = self._coerce(value, props[name], name, errors)
        if errors:
            raise ToolValidationError("Аргументы инструмента «%s» не подходят к его схеме:\n- %s"
                                      % (self.name, "\n- ".join(errors)))
        return kwargs

    # --- запуск ---
    def invoke(self, input, config=None, **kwargs):
        call = input if isinstance(input, dict) and input.get("type") == "tool_call" else None
        args = call["args"] if call else input
        result = self.func(**self._parse_input(args))
        if call:
            content = result if isinstance(result, str) else _stringify(result)
            return ToolMessage(content=content, name=self.name, tool_call_id=call["id"])
        return result

    def run(self, tool_input, **kwargs):
        return self.func(**self._parse_input(tool_input))


def tool(*args, description=None, return_direct=False, args_schema=None, infer_schema=True,
         response_format="content", parse_docstring=False, error_on_invalid_docstring=True):
    """@tool, @tool("имя") или @tool(parse_docstring=True): функция → инструмент StructuredTool."""

    def make(func, name=None):
        return StructuredTool.from_function(func, name=name, description=description, return_direct=return_direct,
                                            parse_docstring=parse_docstring,
                                            error_on_invalid_docstring=error_on_invalid_docstring)

    if len(args) == 1 and callable(args[0]) and not isinstance(args[0], str):
        return make(args[0])
    if len(args) == 1 and isinstance(args[0], str):
        return lambda func: make(func, args[0])
    if len(args) == 2 and isinstance(args[0], str) and callable(args[1]):
        return make(args[1], args[0])
    if not args:
        return lambda func: make(func)
    raise ValueError("Декоратор пишут так: @tool, @tool('имя') или @tool(parse_docstring=True).")
