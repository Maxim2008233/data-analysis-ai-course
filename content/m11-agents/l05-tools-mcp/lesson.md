---
id: m11-l5
title: "Инструменты: LangChain и протокол MCP"
duration: 22
summary: "Тот же агент, что в уроке 11.4, — на готовых классах LangChain. Декоратор @tool превращает функцию в инструмент с описанием и схемой аргументов. Модель возвращает не текст, который надо разбирать регулярными выражениями, а список вызовов tool_calls. Программа отвечает сообщениями ToolMessage. Потом — взгляд с другой стороны: как сделать инструмент, которым сможет пользоваться любой агент. Для этого есть открытый стандарт MCP. Пишем MCP-сервер в миниатюре: запросы tools/list и tools/call в формате JSON-RPC и два вида ошибок."
introduces: [langchain-tools, mcp]
uses: [function-calling, react-loop, ai-agent]
setup: |
  import json
  import re
  from langchain_core.tools import tool
  from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
  from langchain_core.language_models import FakeMessagesListChatModel
  from langchain_core.utils.function_calling import convert_to_openai_tool
  SCHEDULE = {'сегодня': ['16:00 — Анализ данных, ауд. 301'],
              'завтра': ['9:00 — История, ауд. 203', '11:00 — Мировая культура, онлайн',
                         '14:00 — Консультация с группой Б-21, ауд. 105']}
sources:
  - "Lec/07_AI агенты.pptx — слайды 26–41: инструменты и API, способы создания агентов (OpenAI, Anthropic, Google, LangChain, LlamaIndex, Hugging Face), стандартизированный протокол — метафора USB-C, MCP: архитектура, серверы (tools, resources, prompts), локальные и удалённые серверы"
  - "Спецификация Model Context Protocol, версия 2025-06-18 — https://modelcontextprotocol.io/specification/2025-06-18 (раздел Tools: tools/list, tools/call, ошибки)"
  - "Документация LangChain — инструменты (@tool), tool_calls, ToolMessage, bind_tools"
---

## Зачем это нужно

В уроке 11.4 мы собрали агента руками: описали инструменты в тексте промпта, разбирали ответ модели регулярными выражениями и сами следили за форматом. Работает, но хрупко. Модель может написать «Action:» с лишним пробелом или выдумать Observation.

Современные модели умеют вызывать функции напрямую (урок 10.6). Вызов приходит не текстом, а отдельным полем ответа — именем инструмента и аргументами в JSON. LangChain оборачивает это в удобные классы, и тот же агент получается короче и надёжнее.

Вторая сторона вопроса — с точки зрения того, кто **пишет** инструменты (лекция, слайды 28–32). Агентов создают на OpenAI, Anthropic, Google, LangChain, LlamaIndex, Hugging Face — у каждого свой формат инструментов. Делать сервис отдельно под каждый? Для этого придумали стандартный протокол **MCP**. Сервис пишут один раз, и им пользуется любой агент, который понимает протокол — как любое устройство с разъёмом USB-C.

## Инструмент LangChain: @tool

Декоратор `@tool` берёт из функции всё, что нужно модели: имя — от имени функции, описание — из строки документации, схему аргументов — из подсказок типов:

```python
@tool
def get_schedule(day: str) -> str:
    """Расписание занятий пользователя на день: «сегодня» или «завтра»."""
    lessons = SCHEDULE.get(day.strip().lower())
    return '; '.join(lessons) if lessons else f'Нет расписания на «{day}».'

@tool(parse_docstring=True)
def calculate(expression: str) -> str:
    """Калькулятор для арифметических выражений.

    Args:
        expression: выражение из чисел, + - * / и скобок, например «3 * 90»
    """
    if not re.fullmatch(r'[\d\s+\-*/().]+', expression) or '**' in expression:
        return 'Ошибка: допустимы только числа, + - * / и скобки'
    try:
        return str(eval(expression, {'__builtins__': {}}, {}))
    except ZeroDivisionError:
        return 'Ошибка: деление на ноль'

print(get_schedule.name, '—', get_schedule.description)
print(calculate.args)
print(json.dumps(convert_to_openai_tool(calculate), ensure_ascii=False, indent=1))
```

`parse_docstring=True` читает строку документации в стиле Google: описание инструмента — до раздела `Args:`, описания аргументов — строки «аргумент: описание» в нём. `convert_to_openai_tool` показывает, что получит модель: имя, описание и JSON Schema аргументов — то самое описание функции из урока 10.6, только собранное автоматически.

Инструмент вызывают методом `invoke` со словарём аргументов. Аргументы проверяются по схеме ещё до вызова функции:

```python
print(get_schedule.invoke({'day': 'завтра'}))
try:
    calculate.invoke({'expr': '3 * 90'})                   # модель перепутала имя аргумента
except ValueError as e:
    print(e)
```

Ошибка в аргументах ловится раньше, чем функция начнёт работать. В настоящем LangChain это `ValidationError` из библиотеки pydantic с английским текстом; учебная версия пишет по-русски.

## Модель просит инструменты: tool_calls

Ответ модели — сообщение `AIMessage`. Если модель хочет вызвать инструменты, в поле `tool_calls` лежит их список: имя, аргументы (уже словарь, не текст) и номер вызова `id`. Программа выполняет каждый вызов и возвращает результат сообщением `ToolMessage` с тем же `tool_call_id`. `tool.invoke(вызов)` делает это сам:

```python
tools = {t.name: t for t in [get_schedule, calculate]}
model = FakeMessagesListChatModel(responses=[
    AIMessage(content='', tool_calls=[{'name': 'get_schedule', 'args': {'day': 'завтра'}, 'id': 'call_1'}]),
    AIMessage(content='', tool_calls=[{'name': 'calculate', 'args': {'expression': '3 * 90'}, 'id': 'call_2'}]),
    AIMessage(content='Завтра у вас три занятия по 90 минут — всего 270 минут.'),
])
messages = [HumanMessage('Сколько минут займут мои занятия завтра, если каждое идёт 90 минут?')]
for step in range(5):
    ai = model.invoke(messages)
    messages.append(ai)
    if not ai.tool_calls:                                  # вызовов нет — это окончательный ответ
        break
    for call in ai.tool_calls:
        messages.append(tools[call['name']].invoke(call))  # ToolMessage с тем же tool_call_id
for m in messages:
    m.pretty_print()
```

Тот же цикл, что в уроке 11.4: модель решает, программа делает. Но разбирать текст больше не нужно — вызовы приходят готовыми структурами. Тестовая модель `FakeMessagesListChatModel` отвечает заготовленными сообщениями, в том числе с `tool_calls`. Так логику агента проверяют без настоящей модели.

`tool_call_id` нужен, потому что модель может попросить несколько вызовов сразу. По номеру она поймёт, какой результат к какому вызову относится.

## Настоящая модель и готовый агент

В Colab со своим ключом тот же код работает с GigaChat. `bind_tools` передаёт модели описания инструментов, и её ответы приходят с `tool_calls`:

```python norun
from langchain_gigachat import GigaChat
llm = GigaChat(credentials=ключ, verify_ssl_certs=False).bind_tools([get_schedule, calculate])
ai = llm.invoke(messages)                     # AIMessage: tool_calls или готовый ответ

# готовый цикл агента (LangChain 1.x; в версиях 0.x — langgraph.prebuilt.create_react_agent)
from langchain.agents import create_agent
agent = create_agent(GigaChat(credentials=ключ, verify_ssl_certs=False), tools=[get_schedule, calculate])
result = agent.invoke({'messages': [{'role': 'user', 'content': 'Сколько минут займут мои занятия завтра?'}]})
print(result['messages'][-1].content)
```

`create_agent` делает внутри то же, что наш цикл: вызывает модель, выполняет `tool_calls`, возвращает `ToolMessage` и повторяет. Библиотеки агентов быстро меняются, поэтому названия функций сверяйте с документацией своей версии. Сам цикл «модель → вызовы → результаты» от версии не зависит.

## Один инструмент — всем агентам: MCP

**MCP (Model Context Protocol)** — открытый стандарт подключения ИИ-приложений к внешним системам (компания Anthropic, 2024; используют многие компании). Устройство (лекция, слайды 37–39):

- **хост** — ИИ-приложение: чат, среда разработки, агент;
- внутри хоста — по **клиенту** на каждый подключённый сервер;
- **MCP-сервер** даёт клиенту три вида возможностей: **tools** — инструменты, **resources** — данные для контекста (файлы, записи базы), **prompts** — готовые шаблоны промптов;
- сервер бывает **локальным** — запускается на вашем компьютере — или **удалённым** — работает в интернете. Удалённые серверы есть, например, у GitHub и Hugging Face.

Клиент и сервер обмениваются сообщениями **JSON-RPC 2.0**: у запроса есть номер `id`, метод `method` и параметры `params`, у ответа — тот же `id` и либо `result`, либо `error`. Для инструментов два метода: `tools/list` — какие инструменты есть, `tools/call` — вызвать один из них.

## MCP-сервер в миниатюре

Настоящие серверы пишут с официальной библиотекой — в Python это пакет `mcp`, где инструмент объявляется декоратором `@mcp.tool()`, как в LangChain. Чтобы увидеть, что происходит внутри, напишем сервер как функцию «запрос → ответ»:

```python
SERVER_TOOLS = {
    'get_schedule': {
        'description': 'Расписание занятий пользователя на день.',
        'inputSchema': {'type': 'object',
                        'properties': {'day': {'type': 'string', 'description': '«сегодня» или «завтра»'}},
                        'required': ['day']},
        'func': lambda args: '; '.join(SCHEDULE[args['day']]),
    },
}

def handle(request):
    """MCP-сервер в миниатюре: запрос JSON-RPC (словарь) → ответ JSON-RPC."""
    rid, method = request.get('id'), request.get('method')
    if method == 'tools/list':
        tools = [{'name': n, 'description': t['description'], 'inputSchema': t['inputSchema']}
                 for n, t in SERVER_TOOLS.items()]
        return {'jsonrpc': '2.0', 'id': rid, 'result': {'tools': tools}}
    if method == 'tools/call':
        name, args = request['params']['name'], request['params'].get('arguments', {})
        if name not in SERVER_TOOLS:
            return {'jsonrpc': '2.0', 'id': rid, 'error': {'code': -32602, 'message': f'Unknown tool: {name}'}}
        try:
            text, failed = SERVER_TOOLS[name]['func'](args), False
        except Exception as e:
            text, failed = f'{type(e).__name__}: {e}', True
        return {'jsonrpc': '2.0', 'id': rid, 'result': {'content': [{'type': 'text', 'text': text}], 'isError': failed}}
    return {'jsonrpc': '2.0', 'id': rid, 'error': {'code': -32601, 'message': f'Method not found: {method}'}}

print(json.dumps(handle({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list'}), ensure_ascii=False, indent=1))
```

`tools/list` возвращает для каждого инструмента имя, описание и схему входа `inputSchema` — тот же JSON Schema, что у функций в уроке 10.6. Клиент передаёт эти описания модели в её собственном формате, поэтому один сервер подходит и GigaChat, и любой другой модели.

## Вызов и два вида ошибок

```python
for request in [
    {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call', 'params': {'name': 'get_schedule', 'arguments': {'day': 'завтра'}}},
    {'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call', 'params': {'name': 'get_schedule', 'arguments': {'day': 'вчера'}}},
    {'jsonrpc': '2.0', 'id': 4, 'method': 'tools/call', 'params': {'name': 'send_email', 'arguments': {}}},
]:
    print(json.dumps(handle(request), ensure_ascii=False))
```

Ошибки бывают двух видов, и протокол их различает:

- **ошибка протокола** — запрос нельзя выполнить: инструмента `send_email` нет. Ответ — поле `error` с кодом JSON-RPC: −32602 — неверные параметры, −32601 — нет такого метода;
- **ошибка инструмента** — инструмент запустился, но не справился: расписания на «вчера» нет. Ответ — обычный `result` с текстом ошибки и `isError: true`. Этот текст увидит модель и сможет исправиться — как Observation с ошибкой в уроке 11.4.

Перед `tools/list` клиент и сервер договариваются о версии протокола и возможностях (запрос `initialize`). Сообщения ходят через стандартный ввод-вывод — для локальных серверов — или по HTTP — для удалённых. Остальное мы уже видели.

## Типичные ошибки

:::mistake Инструмент без описания
`@tool` без строки документации вызывает ошибку, и это правильно: модель решает, звать ли инструмент и что подать на вход, только по описанию. «Полезная функция» ничего ей не скажет. Нужно — что делает инструмент, когда его звать и пример входа.
:::

:::mistake Потерять tool_call_id
`ToolMessage` без номера вызова (или с чужим номером) модель не свяжет со своей просьбой. Самый надёжный способ — `tool.invoke(call)`: результат придёт с правильным `tool_call_id`.
:::

:::mistake Путать ошибку протокола и ошибку инструмента
«Инструмента нет» — ошибка протокола: поле `error`, модель её обычно не видит. «Инструмент не справился» — результат с `isError: true`: его текст получает модель, чтобы попробовать иначе. Если сбой инструмента отдать как ошибку протокола, модель не узнает, что пошло не так.
:::

## Мини-квиз

```quiz
- q: Откуда @tool берёт описание инструмента для модели?
  options:
    - Из строки документации (docstring) функции
    - Из имени файла
    - Модель придумывает его сама
  answer: 0
  explain: Имя — от имени функции, описание — из docstring, схема аргументов — из подсказок типов.
- q: Модель вернула AIMessage с двумя tool_calls. Что делает программа?
  options:
    - Выполняет оба вызова и добавляет два ToolMessage с их tool_call_id
    - Выполняет только первый
    - Отвечает пользователю текстом модели
  answer: 0
  explain: Модель может попросить несколько вызовов сразу; каждый результат возвращается со своим номером.
- q: Какой метод MCP сообщает клиенту, какие инструменты есть на сервере?
  options:
    - tools/list
    - tools/call
    - initialize
  answer: 0
  explain: tools/list возвращает имена, описания и схемы входа; tools/call вызывает инструмент.
- q: Инструмент сервера MCP не нашёл данных и выбросил исключение. Как сервер отвечает по протоколу?
  options:
    - result с текстом ошибки и isError: true — его увидит модель
    - error с кодом −32601
    - пустой ответ
  answer: 0
  explain: Это ошибка инструмента, а не протокола. Её текст передают модели, чтобы та могла исправиться.
```

## Что запомнить

- `@tool` превращает функцию в инструмент: имя, описание из docstring и схема аргументов из подсказок типов.
- Модель возвращает вызовы в `AIMessage.tool_calls`; программа выполняет их и отвечает `ToolMessage` с тем же `tool_call_id`.
- Логику агента проверяют на `FakeMessagesListChatModel`, а в Colab подставляют настоящую модель через `bind_tools`.
- MCP — открытый стандарт: сервер даёт инструменты, данные и шаблоны; `tools/list` и `tools/call` в формате JSON-RPC.
- Ошибка протокола (`error`) — запрос нельзя выполнить; ошибка инструмента (`isError: true`) — текст для модели.
