# Эталонное решение соревнования 2 для валидатора контента (не показывается ученикам).
# Подписи photo_group («a photo of a {перевод}, a type of {группа}.») и кандидаты той же группы и языка —
# вариант, выбранный по dev открытой половины в уроке С2.2. На скрытых классах — 617 верных из 706 (87,4 %).
import numpy as np
import pandas as pd

test = pd.read_csv('competition_zs_test.csv')
test_emb = np.load('competition_zs_test.npy').astype(np.float32)
with np.load('zs_prompts.npz') as data:
    prompts = pd.DataFrame({k: [str(x) for x in data[k]] for k in ['class', 'group', 'language', 'variant']})
    prompt_emb = data['emb'].astype(np.float32)

raw = prompts[prompts['variant'] == 'raw']
classes = raw['class'].to_numpy()
E = prompt_emb[(prompts['variant'] == 'photo_group').to_numpy()]
allowed = ((test['group'].to_numpy()[:, None] == raw['group'].to_numpy()[None, :]) &
           (test['language'].to_numpy()[:, None] == raw['language'].to_numpy()[None, :]))
S = np.where(allowed, test_emb @ E.T, -np.inf)
submission = pd.DataFrame({'ID': test['ID'], 'predicted_class': classes[S.argmax(axis=1)]})
