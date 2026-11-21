# -*- coding: utf-8 -*-
"""Описание инструмента в формате, который понимают чат-модели (function calling):

convert_to_openai_tool(инструмент) → {'type': 'function', 'function': {'name', 'description', 'parameters'}}

Принимает инструмент LangChain (@tool), обычную функцию Python (описание и аргументы — из docstring в стиле Google и
подсказок типов) или уже готовый словарь. Такой словарь модель получает вместе с сообщениями.
"""
from ..tools import BaseTool, StructuredTool

__all__ = ["convert_to_openai_function", "convert_to_openai_tool"]


def _rm_titles(properties):
    return {name: {k: v for k, v in s.items() if k != "title"} for name, s in properties.items()}


def convert_to_openai_function(function):
    if isinstance(function, dict):
        if "name" in function and ("parameters" in function or "description" in function):
            return dict(function)
        if function.get("type") == "function" and "function" in function:
            return dict(function["function"])
        raise ValueError("Словарь не похож на описание функции: нужны ключи name, description и parameters.")
    if isinstance(function, BaseTool):
        tool = function
    elif callable(function):
        tool = StructuredTool.from_function(function, parse_docstring=True, error_on_invalid_docstring=False)
    else:
        raise TypeError("Описание строят из инструмента (@tool), функции Python или словаря, а получено %s."
                        % type(function).__name__)
    schema = tool.args_schema.model_json_schema()
    params = {"properties": _rm_titles(schema["properties"])}
    if schema.get("required"):
        params["required"] = list(schema["required"])
    params["type"] = "object"
    return {"name": tool.name, "description": tool.description, "parameters": params}


def convert_to_openai_tool(tool):
    if isinstance(tool, dict) and tool.get("type") == "function" and "function" in tool:
        return dict(tool)
    return {"type": "function", "function": convert_to_openai_function(tool)}
