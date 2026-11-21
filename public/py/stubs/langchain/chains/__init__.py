# -*- coding: utf-8 -*-
"""LLMChain — старый способ собрать цепочку «шаблон → модель», как в ноутбуке курса.

В новых версиях LangChain LLMChain устарел: ту же цепочку записывают как prompt | llm | StrOutputParser().
"""
from langchain_core.language_models.fake_chat_models import to_messages
from langchain_core.messages import BaseMessage

__all__ = ["LLMChain"]


class LLMChain:
    """LLMChain(llm=модель, prompt=шаблон): run(**значения) → текст ответа, invoke({...}) → словарь с ключом 'text'."""

    def __init__(self, llm, prompt, output_key="text", **kwargs):
        self.llm = llm
        self.prompt = prompt
        self.output_key = output_key

    def _inputs(self, args, kwargs):
        if kwargs:
            return dict(kwargs)
        if len(args) == 1 and isinstance(args[0], dict):
            return dict(args[0])
        if len(args) == 1 and len(self.prompt.input_variables) == 1:
            return {self.prompt.input_variables[0]: args[0]}
        raise TypeError("LLMChain.run: передайте значения переменных шаблона %s по именам." % self.prompt.input_variables)

    def run(self, *args, **kwargs):
        value = self.prompt.invoke(self._inputs(args, kwargs))
        answer = self.llm.invoke(to_messages(value))
        return answer.content if isinstance(answer, BaseMessage) else str(answer)

    def invoke(self, inputs, config=None):
        return {**inputs, self.output_key: self.run(**inputs)}

    def __repr__(self):
        return "LLMChain(prompt=%r, llm=%r)" % (self.prompt, self.llm)
