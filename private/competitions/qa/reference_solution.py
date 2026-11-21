# Эталон для валидатора контента: baseline, где недопустимые номера заменены самым частым правильным номером
# обучающих вопросов. Должен обгонять baseline из реестра.
import ast
import json
import warnings
import pandas as pd

test = pd.read_csv('qa_test.csv')
train = pd.read_csv('qa_train.csv')
baseline = pd.read_csv('qa_gigachat_baseline.csv')


def n_options(s):
    s = s.strip().rstrip(',').strip()
    try:
        v = json.loads(s)
    except json.JSONDecodeError:
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', SyntaxWarning)
            try:
                v = ast.literal_eval(s)
            except (ValueError, SyntaxError):
                return 0
    return len(v) if isinstance(v, (list, tuple)) else 0


n = test.set_index('id')['варианты'].map(n_options)
pred = baseline.set_index('id')['prediction'].copy()
fallback = int(train['ответ'].mode()[0])
bad = (pred < 0) | (pred >= n.reindex(pred.index))
pred[bad] = fallback
submission = pd.DataFrame({'id': pred.index, 'prediction': pred.values})
