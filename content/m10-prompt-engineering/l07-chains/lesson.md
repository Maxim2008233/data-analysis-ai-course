---
id: m10-l7
title: "Цепочки LangChain и тестовая модель"
duration: 18
summary: "LLM-приложение — это шаги: шаблон → модель → разбор ответа. LangChain даёт для них одинаковые блоки и собирает цепочку оператором |. Запускаем код ноутбука курса: сообщения SystemMessage и HumanMessage, цепочку рассуждений «шаг за шагом» (chain of thought) с настоящими ответами GigaChat. Проверяем логику цепочки на тестовой модели FakeListChatModel, не тратя токенов, и смотрим, как GigaChat уверенно выдумал неработающий код."
introduces: [llm-chain]
uses: [llm-chat-api, structured-output, few-shot]
files: [gigachat_notebook.json]
setup: |
  import json
  import re
  from langchain_gigachat import GigaChat
  from langchain.schema import SystemMessage, HumanMessage
  from langchain.prompts import PromptTemplate
  from langchain.chains import LLMChain
  from langchain_core.output_parsers import StrOutputParser, JsonOutputParser
  from langchain_core.language_models import FakeListChatModel
  from langchain_core.runnables import RunnableLambda
  with open('gigachat_notebook.json', encoding='utf-8') as fh:
      notebook = {r['id']: r for r in json.load(fh)['records']}
sources:
  - "Workshops/2025/06_PromptEng.ipynb — раздел «О более продвинутом пути к LLM-приложениям»: langchain_gigachat, SystemMessage, HumanMessage, AIMessage, метод invoke, PromptTemplate и LLMChain, цепочка рассуждений (chain of thought)"
  - "Документация LangChain — LangChain Expression Language (оператор |), FakeListChatModel для тестов"
---

## Зачем это нужно

В уроках 10.4–10.5 у нас сложились шаги любого LLM-приложения: собрать промпт по шаблону, отправить модели, разобрать ответ, проверить. Каждый раз писать их заново долго. Библиотека **LangChain** даёт для шагов готовые блоки с одинаковым методом `invoke` и соединяет их в **цепочку** оператором `|`:

```text
chain = шаблон | модель | разбор
chain.invoke({'переменная': значение})
```

Как сказано в ноутбуке курса, LangChain берёт на себя типичную работу — сообщения, вызовы функций, повторные запросы, формат вывода. Для GigaChat есть пакет `langchain_gigachat`. В браузере работает его учебная версия: как и в уроке 10.1, она воспроизводит ответы, записанные в ноутбуке.

## Сообщения LangChain

Вместо словарей `{'role': ..., 'content': ...}` в LangChain — классы: `SystemMessage`, `HumanMessage` (user) и `AIMessage` (assistant). Код ноутбука как есть, с его опечатками — запрос должен совпасть с записанным:

```python
llm = GigaChat(model='GigaChat-Pro', credentials='ваш-ключ', verify_ssl_certs=False, streaming=False)
msg = [SystemMessage(content='Отвечай как инженр-датасаинтист с 20 летним опытом. Используй Markdown разметку ответа. Ответ не должен быть длинее 10 строк')]
question = 'Какие приемущества может дать langchain в работе с GigaChat'
msg.append(HumanMessage(question))
response = llm.invoke(msg)
print(type(response).__name__)
print(response.content[:600])
```

Модель вернула `AIMessage`, его текст — в `.content`. В ноутбуке напечатаны только первые 600 символов ответа, поэтому и здесь он обрывается. Чтобы продолжить разговор, ответ добавляют в историю: `msg.append(AIMessage(content=...))` — роль `assistant`, как в уроке 10.3.

## Цепочка рассуждений

В ноутбуке модель решает задачи «шаг за шагом». Такой приём называют **chain of thought** — цепочка рассуждений. Модель сначала расписывает, что дано и что найти, потом считает по шагам, проверяет и только в конце даёт ответ. Так меньше ошибок в задачах из нескольких действий: каждое действие записано, и модель опирается на уже посчитанное.

```python
cot_template = """
Реши задачу шаг за шагом:

Задача: {problem}

Пожалуйста:
1. Сначала пойми, что дано и что нужно найти
2. Разбей решение на логические шаги
3. Выполни вычисления для каждого шага
4. Проверь правильность рассуждений
5. Сформулируй окончательный ответ

"""
cot_prompt = PromptTemplate(input_variables=['problem'], template=cot_template)
problems = ['В классе 30 учеников. 40% из них - девочки. Сколько мальчиков в классе?',
            'Книга стоит 500 рублей. После скидки цена снизилась на 20%. Сколько стоит книга после скидки?']

cot_chain = cot_prompt | llm | StrOutputParser()
for problem in problems:
    result = cot_chain.invoke({'problem': problem})
    print(problem, '→ …', result[-45:].replace('\n', ' '), f'({len(result)} символов)')
print(cot_chain)
print(LLMChain(llm=llm, prompt=cot_prompt).run(problem=problems[0]) == cot_chain.invoke({'problem': problems[0]}))
```

`cot_prompt | llm | StrOutputParser()` — три шага: шаблон превращает словарь в текст промпта, модель отвечает сообщением, `StrOutputParser` достаёт из него текст. В ноутбуке та же цепочка записана старым способом — `LLMChain(llm=llm, prompt=cot_prompt).run(problem=...)`. Результат тот же, но в новых версиях LangChain `LLMChain` устарел.

Оба ответа верны: 18 мальчиков и 400 рублей. Но за них заплачено токенами: 1110 и 991 символов, около 200 токенов на задачу вместо нескольких. И ответ спрятан в конце текста — достают его, как в уроке 10.5.

## Тестовая модель

Как проверить цепочку, не тратя токенов и не завися от случайных ответов? Подставить вместо модели **тестовую** — `FakeListChatModel`. Она отвечает заранее заданными текстами по очереди. Проверим, как цепочка переживёт ответы не по формату:

```python
template = PromptTemplate.from_template('Вопрос: {question}\nОтветь одной цифрой — номером варианта от 0 до 3.')

def parse_digit(text):
    m = re.fullmatch(r'\s*(\d+)\s*\.?\s*', text)
    return int(m.group(1)) if m and int(m.group(1)) < 4 else None

fake = FakeListChatModel(responses=['2', 'Ответ: 1', '4', ' 0 '])
chain = template | fake | StrOutputParser() | RunnableLambda(parse_digit)
print(chain.batch([{'question': f'Вопрос {i}'} for i in range(4)]))
```

`RunnableLambda` превращает обычную функцию в шаг цепочки, а `batch` запускает цепочку на списке входов. Ответы тестовой модели придумали мы сами — в этом и смысл: проверяется логика цепочки, а не модель. Когда всё работает, `fake` заменяют на настоящую модель, и остальная цепочка не меняется.

## JSON в цепочке

`JsonOutputParser` разбирает JSON из ответа. Если модель ответила не JSON, он выбрасывает ошибку `OutputParserException`:

```python
jchain = template | FakeListChatModel(responses=['{"answer": 2}', 'Думаю, это вариант 2']) | JsonOutputParser()
print(jchain.invoke({'question': 'первый'}))
try:
    jchain.invoke({'question': 'второй'})
except Exception as e:
    print(type(e).__name__, '—', e)
```

Ошибку ловят и решают, что делать дальше: переспросить, поставить запасной ответ (урок 10.5). Тестовая модель позволяет заранее убедиться, что программа это переживёт.

## Модель уверенно выдумывает

В ноутбуке GigaChat попросили привести пример цепочки с `langchain_gigachat`. Вот начало ответа:

```python
print(notebook['langchain-example']['response'][:430])
```

Код выглядит убедительно, но не работает. Модель подключает «GigaChat» через `HuggingFaceHub` — это другой сервис с другим ключом, и модели с именем `gigachat` там нет. Правильный способ показан в самом ноутбуке: `from langchain_gigachat import GigaChat`. Такие правдоподобные выдумки называют **галлюцинациями**. Код, факты, ссылки и цифры от модели проверяют — запуском, по документации, по источнику.

## Типичные ошибки

:::mistake Проверять цепочку только на настоящей модели
Ответы случайны, а каждый запуск стоит токенов. Логику — шаблон, разбор, обработку ошибок — проверяют на `FakeListChatModel` с известными ответами, в том числе неправильными.
:::

:::mistake Забыть парсер в конце цепочки
Без `StrOutputParser` цепочка вернёт объект `AIMessage`, а не строку. Сравнение с текстом или `re.fullmatch` по нему не сработает.
:::

:::mistake Верить уверенному тону
Модель пишет неправильный код так же гладко, как правильный. Её код запускают, а факты проверяют по источникам.
:::

## Мини-квиз

```quiz
- q: Что делает запись prompt | llm | StrOutputParser()?
  options:
    - Собирает цепочку — выход каждого шага становится входом следующего
    - Выбирает один из трёх шагов
    - Запускает три модели параллельно
  answer: 0
  explain: chain.invoke({...}) заполнит шаблон, отправит промпт модели и вернёт текст ответа.
- q: Зачем нужна FakeListChatModel?
  options:
    - Проверить логику цепочки на заранее известных ответах, без настоящей модели и токенов
    - Она отвечает лучше настоящей модели
    - Она ускоряет GigaChat
  answer: 0
  explain: Потом тестовую модель заменяют настоящей, а цепочка не меняется.
- q: Что такое chain of thought?
  options:
    - Просьба решать по шагам и только потом давать ответ
    - Цепочка из нескольких моделей
    - Перевод ответа на английский
  answer: 0
  explain: Ответ точнее на многошаговых задачах, но длиннее — около 200 токенов на задачу в ноутбуке.
- q: Модель уверенно написала код подключения к сервису. Что делать?
  options:
    - Проверить — запустить, свериться с документацией
    - Сразу использовать — модель не ошибается в коде
    - Попросить модель подтвердить, что код верный
  answer: 0
  explain: В ноутбуке GigaChat выдумал подключение через HuggingFaceHub, которое не работает.
```

## Что запомнить

- Цепочка LangChain: `prompt | llm | parser`, запуск — `invoke` для одного входа и `batch` для списка.
- Сообщения в LangChain — `SystemMessage`, `HumanMessage`, `AIMessage`, ответ модели — `AIMessage` с текстом в `.content`.
- Цепочку проверяют на `FakeListChatModel`, в том числе на ответах не по формату, а потом подставляют настоящую модель.
- Рассуждение по шагам повышает точность, но стоит токенов. Код и факты из ответа модели проверяют.
