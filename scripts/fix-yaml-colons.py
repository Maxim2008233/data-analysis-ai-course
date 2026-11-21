"""Заключить в кавычки однострочные значения YAML, содержащие «: » (иначе YAML видит вложенный словарь).

Правила:
  * `ключ: значение с «: » внутри` → `ключ: "…"` (ключ — латинский идентификатор);
  * элемент списка `- Текст: продолжение`, где «Текст» — не идентификатор (кириллица, пробелы) →
    `- "Текст: продолжение"`: это строка, а не словарь (например, подсказка);
  * строки внутри блочных скаляров (`ключ: |` или `ключ: >`) не трогаются — это обычный текст.

Использование: python3 scripts/fix-yaml-colons.py файл.yaml [...]
"""
import re
import sys

LINE = re.compile(r'^(\s*(?:-\s+)?)([A-Za-z_][\w-]*):\s+(.*)$')
ITEM = re.compile(r'^(\s*-\s+)(?![\'"|>\[{&*!#])([^:]*?):\s+(.*)$')
BLOCK_START = re.compile(r':\s*[|>][-+]?\s*$')


def quote(text):
    return '"%s"' % text.replace('\\', '\\\\').replace('"', '\\"')


for path in sys.argv[1:]:
    lines = open(path, encoding='utf-8').read().split('\n')
    changed = 0
    block_indent = None
    for i, line in enumerate(lines):
        stripped = line.lstrip(' ')
        indent = len(line) - len(stripped)
        if block_indent is not None:
            if stripped == '' or indent > block_indent:
                continue  # текст блочного скаляра
            block_indent = None
        if BLOCK_START.search(line):
            block_indent = indent + 2 if stripped.startswith('- ') else indent
            continue
        mi = ITEM.match(line)
        if mi and not re.fullmatch(r'[A-Za-z_][\w-]*', mi.group(2)):
            prefix = mi.group(1)
            lines[i] = prefix + quote(line[len(prefix):])
            changed += 1
            continue
        m = LINE.match(line)
        if not m:
            continue
        prefix, key, val = m.groups()
        if not val or val[0] in '"\'|>[{&*!#' or ': ' not in val:
            continue
        lines[i] = '%s%s: %s' % (prefix, key, quote(val))
        changed += 1
    if changed:
        open(path, 'w', encoding='utf-8').write('\n'.join(lines))
    print(path, 'исправлено строк:', changed)
