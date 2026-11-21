# -*- coding: utf-8 -*-
class OutputParserException(ValueError):
    """Ответ модели не удалось разобрать в нужный формат."""

    def __init__(self, error, llm_output=None):
        super().__init__(error)
        self.llm_output = llm_output
