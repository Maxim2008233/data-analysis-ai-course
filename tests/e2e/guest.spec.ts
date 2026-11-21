// Сценарии без аккаунта: 1 (гость), 5 (сообщения, подсказки, решение), 6 (бесконечный цикл),
// 10 (экспорт/импорт), 13 (задание с графиком и квиз), 15 (Plotly и Seaborn), 16 (scikit-learn), 17 (модуль 6),
// 18 (модуль 7: Target Encoding, LightGBM, Q–Q-график), 19 (соревнование: проверка прогнозов на сервере),
// 20 (модуль 8: нейросети — пример без лишних предупреждений, свой цикл обучения, граница решений),
// 21 (модуль 9: учебная transformers в браузере — pipeline, токенизатор, CLIP),
// 22 (соревнование 2: ответы-классы, доля верных на сервере, ошибка формата), 23 (модуль 10: учебный GigaChat и LangChain),
// 24 (соревнование 3: ответы кодом и загрузкой CSV), 25 (модуль 11: инструменты LangChain, голосовой чат, цикл агента),
// 26 (модуль 12 и КТ 2: спектрограмма, поиск названий, CLIP, инструмент LangChain), 27 (бонус-модуль: разбор цели lab8, свои алгоритмы),
// 28 (долгий сеанс: перезапуск Python при переполнении памяти).
import fs from "node:fs";
import { test, expect, openTask, setCode, getCode, checkTask, solveTask, findTask, TOTAL_TASKS } from "./helpers";

test("1. Гость: пример, задание, обновление страницы — прогресс и код сохранились", async ({ page }) => {
  await page.goto("/learn/m01-numpy/l01-question-to-table");
  // шаг с первым примером кода
  const step = await page.evaluate(() => (document.querySelector('[data-testid="runnable-example"]')?.closest("[data-step]") as HTMLElement)?.dataset.step);
  await page.goto(`/learn/m01-numpy/l01-question-to-table#step-${step}`);
  const ex = page.locator(`[data-step="${step}"] [data-testid="runnable-example"]`).first();
  await ex.getByTestId("run-example").click();
  await expect(ex.getByTestId("output")).toContainText("Столбцы", { timeout: 120_000 });

  await solveTask(page, "m1-l1-t1");
  const { task } = findTask("m1-l1-t1");
  await page.reload();
  const card = page.locator('[data-task-id="m1-l1-t1"]');
  await expect(card).toHaveAttribute("data-status", "solved");
  await expect.poll(() => getCode(page, "m1-l1-t1")).toBe(task.solution);
  // шаг задания в полоске — зелёный
  await expect(page.locator('[data-testid="step-button"][data-status="solved"]').first()).toBeVisible();
});

test("5. Неверное решение: понятное сообщение; подсказки по уровням; «Показать решение» по правилам", async ({ page }) => {
  // вписанный вручную ответ ловится проверкой на другой части данных
  await openTask(page, "m1-l2-t1");
  await setCode(page, "m1-l2-t1", "n_rows, n_features = 41007, 4\n");
  let r = await checkTask(page, "m1-l2-t1");
  expect(r.passed).toBe(false);
  expect(r.text).toContain("вписано вручную");

  // подсказки открываются по одной, решение — после третьей
  const card = page.locator('[data-task-id="m1-l2-t1"]');
  await expect(card.getByTestId("solution-locked")).toBeVisible();
  await expect(card.getByTestId("show-solution")).toHaveCount(0);
  for (let i = 1; i <= 3; i++) {
    await card.getByTestId("open-hint").click();
    await expect(card.getByTestId("hint")).toHaveCount(i);
  }
  await expect(card.getByTestId("open-hint")).toHaveCount(0);
  await card.getByTestId("show-solution").click();
  await expect(card.getByTestId("solution")).toContainText("X.shape");

  // другое задание: три неудачные проверки открывают кнопку решения без подсказок
  await openTask(page, "m1-l2-t2");
  const card2 = page.locator('[data-task-id="m1-l2-t2"]');
  for (let i = 0; i < 3; i++) {
    await setCode(page, "m1-l2-t2", `row_id = np.arange(${10 + i})\n`);
    r = await checkTask(page, "m1-l2-t2");
    expect(r.passed).toBe(false);
  }
  await expect(card2.getByTestId("show-solution")).toBeVisible();
  // ошибка Python объясняется по-русски, исходный traceback — по кнопке
  await setCode(page, "m1-l2-t2", "row_id = np.arange(X.shape[0]\n");
  r = await checkTask(page, "m1-l2-t2");
  await expect(card2.getByTestId("error-box")).toContainText("Синтаксическая ошибка");
  await card2.getByTestId("error-box").getByRole("button", { name: /traceback/ }).click();
  await expect(card2.getByTestId("error-box")).toContainText("SyntaxError");
});

test("6. Бесконечный цикл: срабатывает таймаут, интерфейс не зависает, можно запустить снова", async ({ page }) => {
  await openTask(page, "m1-l2-t3");
  await setCode(page, "m1-l2-t3", "while True:\n    pass\n");
  const card = page.locator('[data-task-id="m1-l2-t3"]');
  await card.getByTestId("run").click();
  // пока код выполняется, интерфейс отвечает: можно переключать шаги
  await page.getByTestId("step-button").first().click();
  await expect(page.getByTestId("step-title")).toContainText("Шаг 1");
  await page.goBack();
  await expect(card.getByTestId("run-note")).toContainText("дольше", { timeout: 60_000 });
  const { task } = findTask("m1-l2-t3");
  await setCode(page, "m1-l2-t3", task.solution ?? "");
  const r = await checkTask(page, "m1-l2-t3");
  expect(r.passed, r.text).toBe(true);
});

test("13. Задание с графиком и задание-квиз проверяются корректно", async ({ page }) => {
  // график без заголовка — понятное сообщение
  await openTask(page, "m0-l4-t5");
  await setCode(page, "m0-l4-t5", "fig, ax = plt.subplots()\nax.bar(fuel, counts)\nax.set_ylabel('Число объявлений')\nplt.show()\n");
  let r = await checkTask(page, "m0-l4-t5");
  expect(r.passed).toBe(false);
  expect(r.text).toContain("заголовок");
  await expect(page.locator('[data-task-id="m0-l4-t5"] [data-testid="plot-image"]').first()).toBeVisible();
  const { task } = findTask("m0-l4-t5");
  await setCode(page, "m0-l4-t5", task.solution ?? "");
  r = await checkTask(page, "m0-l4-t5");
  expect(r.passed, r.text).toBe(true);

  // квиз: сначала одна ошибка, потом верные ответы
  const card = await openTask(page, "m0-l4-t2");
  const questions = card.getByTestId("quiz-question");
  // варианты показываются в перемешанном порядке — выбираем по исходному номеру варианта
  const option = (q: number, i: number) => questions.nth(q).locator(`label[data-option="${i}"]`);
  await option(0, 0).click();
  await option(1, 1).click();
  await option(2, 1).click();
  await card.getByTestId("quiz-submit").click();
  await expect(card.getByTestId("quiz-score")).toContainText("Верно: 2 из 3");
  await expect(card).toHaveAttribute("data-status", "in_progress");
  await option(0, 1).click();
  await card.getByTestId("quiz-submit").click();
  await expect(card.getByTestId("quiz-score")).toContainText("Верно: 3 из 3");
  await expect(card).toHaveAttribute("data-status", "solved");
});

test("10. Экспорт и импорт прогресса", async ({ page }) => {
  await solveTask(page, "m1-l0-t1");
  await page.goto("/profile");
  await expect(page.getByTestId("stat-solved")).toHaveText(`1 / ${TOTAL_TASKS}`);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-progress").click()]);
  const file = await download.path();
  const data = JSON.parse(fs.readFileSync(file!, "utf8"));
  expect(data.format).toBe("ds-course-progress");
  expect(data.items["task:m1-l0-t1"].status).toBe("solved");

  await page.getByTestId("reset-progress").click();
  await page.getByTestId("reset-confirm").click();
  await expect(page.getByTestId("stat-solved")).toHaveText(`0 / ${TOTAL_TASKS}`);

  await page.getByTestId("import-file").setInputFiles(file!);
  await expect(page.getByTestId("io-message")).toContainText("Импортировано");
  await expect(page.getByTestId("stat-solved")).toHaveText(`1 / ${TOTAL_TASKS}`);
  // код тоже восстановился
  await openTask(page, "m1-l0-t1");
  await expect.poll(() => getCode(page, "m1-l0-t1")).toBe(findTask("m1-l0-t1").task.solution);
});

test("15. Интерактивный график Plotly и Seaborn: проверка проходит, график рисуется и не перекрывает текст", async ({ page }) => {
  // plotly 7 и seaborn ставятся через micropip с PyPI, plotly.js — с jsDelivr: первая загрузка дольше обычной
  test.setTimeout(420_000);
  const { task } = findTask("m4-l10-t1");
  await openTask(page, "m4-l10-t1");
  await setCode(page, "m4-l10-t1", task.solution ?? "");
  const r = await checkTask(page, "m4-l10-t1");
  expect(r.passed, r.text).toBe(true);
  const figure = page.locator('[data-task-id="m4-l10-t1"] [data-testid="plotly-figure"]').first();
  await expect(figure.locator(".main-svg").first()).toBeVisible({ timeout: 120_000 });
  const geometry = await figure.evaluate((el) => {
    const svg = el.querySelector(".main-svg");
    return { box: el.getBoundingClientRect().height, svg: Number(svg?.getAttribute("height") ?? 0), traces: el.querySelectorAll(".legendtext").length };
  });
  expect(geometry.svg).toBeGreaterThan(300);
  expect(Math.abs(geometry.box - geometry.svg)).toBeLessThan(2); // контейнер не меньше рисунка — нет наложения на текст ниже
  expect(geometry.traces).toBe(2); // легенда: Automatic и Manual

  // задание с Seaborn (боксплоты) проверяется по объектам Matplotlib
  const box = findTask("m4-l7-t2");
  await openTask(page, "m4-l7-t2");
  await setCode(page, "m4-l7-t2", box.task.solution ?? "");
  const r2 = await checkTask(page, "m4-l7-t2");
  expect(r2.passed, r2.text).toBe(true);
  await expect(page.locator('[data-task-id="m4-l7-t2"] [data-testid="plot-image"]').first()).toBeVisible();
});

test("16. Scikit-learn в браузере: модель и график «прогноз — факт» проверяются, утечка в scaler даёт понятное сообщение", async ({ page }) => {
  // scikit-learn и SciPy — крупные пакеты Pyodide: первая загрузка дольше обычной
  test.setTimeout(420_000);
  const { task } = findTask("m5-l9-t2");
  await openTask(page, "m5-l9-t2");
  await setCode(page, "m5-l9-t2", task.solution ?? "");
  const r = await checkTask(page, "m5-l9-t2");
  expect(r.passed, r.text).toBe(true);
  await expect(page.locator('[data-task-id="m5-l9-t2"] [data-testid="plot-image"]').first()).toBeVisible();

  // мини-проект на diabetes.csv: scaler, обученный на всех данных, — утечка
  const leak = findTask("m5-l10-t5");
  const wrong = (leak.task.wrong ?? []).find((w) => w.expect === "утечка");
  expect(wrong, "в задании m5-l10-t5 должно быть неверное решение с утечкой").toBeTruthy();
  await openTask(page, "m5-l10-t5");
  await setCode(page, "m5-l10-t5", wrong!.code);
  const bad = await checkTask(page, "m5-l10-t5");
  expect(bad.passed).toBe(false);
  expect(bad.text).toContain("утечка");
  await setCode(page, "m5-l10-t5", leak.task.solution ?? "");
  const good = await checkTask(page, "m5-l10-t5");
  expect(good.passed, good.text).toBe(true);
});

test("17. Модуль 6: кросс-валидация и дерево решений проверяются в браузере, ошибка знака даёт понятное сообщение", async ({ page }) => {
  test.setTimeout(420_000);
  const cv = findTask("m6-l8-t3");
  const sign = (cv.task.wrong ?? []).find((w) => w.expect === "со знаком минус");
  expect(sign, "в задании m6-l8-t3 должно быть неверное решение без смены знака").toBeTruthy();
  await openTask(page, "m6-l8-t3");
  await setCode(page, "m6-l8-t3", sign!.code);
  const bad = await checkTask(page, "m6-l8-t3");
  expect(bad.passed).toBe(false);
  expect(bad.text).toContain("со знаком минус");
  await setCode(page, "m6-l8-t3", cv.task.solution ?? "");
  const good = await checkTask(page, "m6-l8-t3");
  expect(good.passed, good.text).toBe(true);

  // дерево решений: задание с функцией из вложенных if и задание с обучением дерева
  for (const id of ["m6-l4-t1", "m6-l4-t2"]) {
    const { task } = findTask(id);
    await openTask(page, id);
    await setCode(page, id, task.solution ?? "");
    const r = await checkTask(page, id);
    expect(r.passed, `${id}: ${r.text}`).toBe(true);
  }
});

test("18. Модуль 7: Target Encoding, LightGBM с категориями и Q–Q-график проверяются в браузере", async ({ page }) => {
  // LightGBM — отдельный пакет Pyodide, он подгружается по import при первой проверке
  test.setTimeout(480_000);
  const te = findTask("m7-l5-t5");
  const fitTransform = (te.task.wrong ?? []).find((w) => w.expect === "через `fit_transform`");
  expect(fitTransform, "в задании m7-l5-t5 должно быть неверное решение с fit и transform").toBeTruthy();
  await openTask(page, "m7-l5-t5");
  await setCode(page, "m7-l5-t5", fitTransform!.code);
  const bad = await checkTask(page, "m7-l5-t5");
  expect(bad.passed).toBe(false);
  expect(bad.text).toContain("fit_transform");
  await setCode(page, "m7-l5-t5", te.task.solution ?? "");
  const good = await checkTask(page, "m7-l5-t5");
  expect(good.passed, good.text).toBe(true);

  for (const id of ["m7-l7-t4", "m7-l8-t4"]) {
    const { task } = findTask(id);
    await openTask(page, id);
    await setCode(page, id, task.solution ?? "");
    const r = await checkTask(page, id);
    expect(r.passed, `${id}: ${r.text}`).toBe(true);
  }
  await expect(page.locator('[data-task-id="m7-l8-t4"] [data-testid="plot-image"]').first()).toBeVisible();
});

test("19. Соревнование: прогнозы из браузера проверяются на сервере по скрытым ответам, ошибка формата объясняется", async ({ page }) => {
  test.setTimeout(480_000);
  await page.goto("/learn/m07z-competition-1/l03-submit#step-2");
  const form = page.getByTestId("competition-submit");
  const editor = form.getByTestId("code-editor");
  await expect(editor).toBeVisible({ timeout: 60_000 });

  // заготовка — baseline из материалов курса: сервер возвращает ровно MAE из реестра
  await form.getByTestId("competition-send").click();
  const result = form.getByTestId("competition-result");
  await expect(result).toBeVisible({ timeout: 300_000 });
  await expect(result).toHaveAttribute("data-mae", "11792");
  await expect(result).toContainText("Проверено 1");
  await expect(form.getByTestId("competition-history")).toBeVisible();

  // типичная ошибка исходного ноутбука — dropna на проверочной таблице: прогнозы не уходят на сервер
  await page.evaluate(() => {
    const host = document.querySelector('[data-testid="competition-submit"] [data-testid="code-editor"]') as HTMLElement & {
      __cmView: { state: { doc: { length: number; toString(): string } }; dispatch: (tr: unknown) => void };
    };
    const view = host.__cmView;
    const code = view.state.doc.toString().replace("X_test = test[X.columns].fillna(X.median())", "test = test.dropna(subset=X.columns)\nX_test = test[X.columns]");
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } });
  });
  await form.getByTestId("competition-send").click();
  const error = form.getByTestId("competition-error");
  await expect(error).toBeVisible({ timeout: 120_000 });
  await expect(error).toContainText("Нет прогнозов для 52 машин");

  // лучший результат сохраняется в прогрессе и виден после перезагрузки; таблица лидеров зовёт войти
  await page.reload();
  await expect(page.getByTestId("competition-best")).toContainText("лучший результат", { timeout: 60_000 });
  await expect(page.getByTestId("leaderboard")).toContainText("только ученики с аккаунтом");
});

test("20. Модуль 8: пример с MLPRegressor без лишних предупреждений, свой цикл обучения сети и граница решений проверяются в браузере", async ({ page }) => {
  test.setTimeout(480_000);
  // пример урока 8.2: фильтр ConvergenceWarning из setup урока действует и на примеры, запущенные позже
  await page.goto("/learn/m08-neural-networks/l02-mlp");
  // шаг «MLPRegressor» — по названию в полоске шагов (код примеров редактор рисует уже после загрузки)
  await page.getByRole("tab", { name: /MLPRegressor/ }).click();
  const ex = page.locator('[data-step]:not([hidden]) [data-testid="runnable-example"]').first();
  await expect(ex).toContainText("MAE сети", { timeout: 60_000 });
  await ex.getByTestId("run-example").click();
  const out = ex.getByTestId("output");
  await expect(out).toContainText("MAE сети: 2826", { timeout: 240_000 });
  await expect(out).not.toContainText("ConvergenceWarning");

  // ошибка внутри функции из подготовки указывает на строку ученика, а не на подготовку
  await openTask(page, "m8-l1-t4");
  const starter = await checkTask(page, "m8-l1-t4");
  expect(starter.passed).toBe(false);
  expect(starter.text).toContain("в вашем коде");

  // свой цикл обучения: без перемешивания — понятное сообщение, эталон проходит
  const loop = findTask("m8-l3-t5");
  const noShuffle = (loop.task.wrong ?? []).find((w) => w.expect === "перемешаны");
  expect(noShuffle, "в задании m8-l3-t5 должно быть неверное решение без перемешивания").toBeTruthy();
  await openTask(page, "m8-l3-t5");
  await setCode(page, "m8-l3-t5", noShuffle!.code);
  const bad = await checkTask(page, "m8-l3-t5");
  expect(bad.passed).toBe(false);
  expect(bad.text).toContain("перемешаны");
  await setCode(page, "m8-l3-t5", loop.task.solution ?? "");
  const good = await checkTask(page, "m8-l3-t5");
  expect(good.passed, good.text).toBe(true);

  // классификация: граница решений по сетке
  const { task } = findTask("m8-l7-t3");
  await openTask(page, "m8-l7-t3");
  await setCode(page, "m8-l7-t3", task.solution ?? "");
  const r = await checkTask(page, "m8-l7-t3");
  expect(r.passed, r.text).toBe(true);
});

test("21. Модуль 9: учебная transformers в браузере — pipeline тональности, свой WordPiece и CLIP проверяются", async ({ page }) => {
  test.setTimeout(480_000);
  // пример урока 9.4: import transformers подгружает учебную версию, ответы совпадают с ноутбуком курса
  await page.goto("/learn/m09-llm-huggingface/l04-pipeline");
  await page.getByRole("tab", { name: /Pipeline: модель одной строкой/ }).click();
  const ex = page.locator('[data-step]:not([hidden]) [data-testid="runnable-example"]').first();
  await expect(ex).toContainText("sentiment-analysis", { timeout: 60_000 });
  await ex.getByTestId("run-example").click();
  const out = ex.getByTestId("output");
  await expect(out).toContainText("'label': 'POSITIVE', 'score': 0.99049", { timeout: 240_000 });
  await expect(out).toContainText("'label': 'NEGATIVE', 'score': 0.99945");

  // функция из заготовки ещё возвращает многоточие — проверка говорит об этом прямо
  await openTask(page, "m9-l4-t4");
  const starter = await checkTask(page, "m9-l4-t4");
  expect(starter.passed).toBe(false);
  expect(starter.text).toContain("многоточие");

  // свой WordPiece: без «##» — понятное сообщение, эталон совпадает с настоящим токенизатором
  const wp = findTask("m9-l5-t5");
  const noHashes = (wp.task.wrong ?? []).find((w) => w.expect === "«##»");
  expect(noHashes, "в задании m9-l5-t5 должно быть неверное решение без «##»").toBeTruthy();
  await openTask(page, "m9-l5-t5");
  await setCode(page, "m9-l5-t5", noHashes!.code);
  const bad = await checkTask(page, "m9-l5-t5");
  expect(bad.passed).toBe(false);
  expect(bad.text).toContain("«##»");
  await setCode(page, "m9-l5-t5", wp.task.solution ?? "");
  const good = await checkTask(page, "m9-l5-t5");
  expect(good.passed, good.text).toBe(true);

  // CLIP: расчёт векторами совпадает с pipeline zero-shot-image-classification
  const { task } = findTask("m9-l7-t2");
  await openTask(page, "m9-l7-t2");
  await setCode(page, "m9-l7-t2", task.solution ?? "");
  const r = await checkTask(page, "m9-l7-t2");
  expect(r.passed, r.text).toBe(true);
});

test("22. Соревнование 2: ответы-классы проверяются на сервере по скрытым классам, перевод вместо класса объясняется", async ({ page }) => {
  test.setTimeout(480_000);
  await page.goto("/learn/m09z-competition-2/l03-submit#step-2");
  const form = page.getByTestId("competition-submit");
  const editor = form.getByTestId("code-editor");
  await expect(editor).toBeVisible({ timeout: 60_000 });

  // заготовка — baseline из ноутбука курса: сервер возвращает ровно долю верных из реестра
  await form.getByTestId("competition-send").click();
  const result = form.getByTestId("competition-result");
  await expect(result).toBeVisible({ timeout: 300_000 });
  await expect(result).toHaveAttribute("data-score", "0.6048");
  await expect(result).toHaveAttribute("data-correct", "427");
  await expect(result).toContainText("Проверено 706 картинок");
  await expect(form.getByTestId("competition-best")).toContainText("60,5 %");

  // типичная ошибка — перевод вместо названия класса: ответы не уходят на сервер
  await page.evaluate(() => {
    const host = document.querySelector('[data-testid="competition-submit"] [data-testid="code-editor"]') as HTMLElement & {
      __cmView: { state: { doc: { length: number; toString(): string } }; dispatch: (tr: unknown) => void };
    };
    const view = host.__cmView;
    const code = view.state.doc.toString().replace("'predicted_class': predicted", "'predicted_class': [p.replace('-', ' ') for p in predicted]");
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } });
  });
  await form.getByTestId("competition-send").click();
  const error = form.getByTestId("competition-error");
  await expect(error).toBeVisible({ timeout: 120_000 });
  await expect(error).toContainText("Неизвестные классы");
});

test("23. Модуль 10: учебный GigaChat отвечает записями ноутбука, свой запрос объяснён, цепочки и шаблоны проверяются", async ({ page }) => {
  test.setTimeout(480_000);
  // пример урока 10.1: код ноутбука как есть, ответ — настоящий ответ GigaChat из ноутбука курса
  await page.goto("/learn/m10-prompt-engineering/l01-chat-request");
  await page.getByRole("tab", { name: /Первый запрос/ }).click();
  const ex = page.locator('[data-step]:not([hidden]) [data-testid="runnable-example"]').first();
  await expect(ex).toContainText("giga.chat(MESSAGE)", { timeout: 60_000 });
  await ex.getByTestId("run-example").click();
  const out = ex.getByTestId("output");
  await expect(out).toContainText("Prompt Engineering (инжиниринг запросов)", { timeout: 240_000 });

  // запроса, которого нет в ноутбуке, учебная версия не знает — и объясняет, где его отправить
  await page.getByRole("tab", { name: /Свой запрос/ }).click();
  const own = page.locator('[data-step]:not([hidden]) [data-testid="runnable-example"]').first();
  await own.getByTestId("run-example").click();
  const ownOut = own.getByTestId("output");
  await expect(ownOut).toContainText("не отправляет запросы", { timeout: 120_000 });
  await expect(ownOut).toContainText("colab.research.google.com");

  // шаблон с JSON: одиночные фигурные скобки объясняются по-русски, эталон проходит
  const tpl = findTask("m10-l4-t2");
  const braces = (tpl.task.wrong ?? []).find((w) => w.expect === "Фигурные скобки");
  expect(braces, "в задании m10-l4-t2 должно быть неверное решение с одиночными скобками").toBeTruthy();
  await openTask(page, "m10-l4-t2");
  await setCode(page, "m10-l4-t2", braces!.code);
  const bad = await checkTask(page, "m10-l4-t2");
  expect(bad.passed).toBe(false);
  expect(bad.text).toContain("Фигурные скобки");
  await setCode(page, "m10-l4-t2", tpl.task.solution ?? "");
  const good = await checkTask(page, "m10-l4-t2");
  expect(good.passed, good.text).toBe(true);

  // цепочка LangChain на тестовой модели: без парсера — подсказка, эталон проходит
  const chain = findTask("m10-l7-t1");
  const noParser = (chain.task.wrong ?? []).find((w) => w.expect === "StrOutputParser");
  expect(noParser, "в задании m10-l7-t1 должно быть неверное решение без парсера").toBeTruthy();
  await openTask(page, "m10-l7-t1");
  await setCode(page, "m10-l7-t1", noParser!.code);
  const noP = await checkTask(page, "m10-l7-t1");
  expect(noP.passed).toBe(false);
  expect(noP.text).toContain("StrOutputParser");
  await setCode(page, "m10-l7-t1", chain.task.solution ?? "");
  const okChain = await checkTask(page, "m10-l7-t1");
  expect(okChain.passed, okChain.text).toBe(true);

  // рассуждение «шаг за шагом» через учебный langchain_gigachat: ответы ноутбука разбираются в 18 и 400
  const cot = findTask("m10-l7-t4");
  await openTask(page, "m10-l7-t4");
  await setCode(page, "m10-l7-t4", cot.task.solution ?? "");
  const okCot = await checkTask(page, "m10-l7-t4");
  expect(okCot.passed, okCot.text).toBe(true);
});

test("24. Соревнование 3: ответы кодом и загрузкой CSV проверяются на сервере, файл с чужими колонками объясняется", async ({ page }) => {
  test.setTimeout(480_000);
  await page.goto("/learn/m10z-competition-3/l03-submit#step-2");
  const form = page.getByTestId("competition-submit");
  await expect(form.getByTestId("code-editor")).toBeVisible({ timeout: 60_000 });

  // заготовка — ответы базового решения из ноутбука курса: ровно baseline из реестра
  await form.getByTestId("competition-send").click();
  const result = form.getByTestId("competition-result");
  await expect(result).toBeVisible({ timeout: 300_000 });
  await expect(result).toHaveAttribute("data-score", "0.6844");
  await expect(result).toHaveAttribute("data-correct", "501");
  await expect(result).toContainText("Проверено 732 вопроса");

  // тот же файл ответов, загруженный как CSV (как из Colab), — тот же результат
  const upload = form.getByTestId("competition-upload");
  await expect(upload).toBeVisible();
  await form.getByTestId("competition-file").setInputFiles("public/data/qa_gigachat_baseline.csv");
  await expect(form.getByTestId("competition-file-name")).toContainText("786 строк", { timeout: 60_000 });
  await expect(form.getByTestId("competition-result")).toHaveAttribute("data-score", "0.6844", { timeout: 120_000 });

  // файл с колонками из другого соревнования — понятная ошибка ещё в браузере
  await form.getByTestId("competition-file").setInputFiles({ name: "submit.csv", mimeType: "text/csv", buffer: Buffer.from("ID,Predict\n1,2\n") });
  const error = form.getByTestId("competition-error");
  await expect(error).toBeVisible({ timeout: 60_000 });
  await expect(error).toContainText("нужны колонки «id» и «prediction»");
});

test("25. Модуль 11: инструменты LangChain и записанный диалог голосового бота работают в браузере, цикл агента проверяется", async ({ page }) => {
  test.setTimeout(480_000);
  // урок 11.5: @tool и описание инструмента для модели — учебный langchain_core.tools загружается в браузере
  await page.goto("/learn/m11-agents/l05-tools-mcp");
  await page.getByRole("tab", { name: /Инструмент LangChain/ }).click();
  const ex = page.locator('[data-step]:not([hidden]) [data-testid="runnable-example"]').first();
  await expect(ex).toContainText("@tool", { timeout: 60_000 });
  await ex.getByTestId("run-example").click();
  const out = ex.getByTestId("output");
  await expect(out).toContainText('"name": "calculate"', { timeout: 240_000 });
  await expect(out).toContainText("выражение из чисел");

  // урок 11.8: голосовой чат воспроизводит ответы GigaChat из ноутбука голосового бота
  await page.goto("/learn/m11-agents/l08-voice-bot");
  await page.getByRole("tab", { name: /Голосовой чат и история/ }).click();
  const voice = page.locator('[data-step]:not([hidden]) [data-testid="runnable-example"]').first();
  await expect(voice).toContainText("class AudioChat", { timeout: 60_000 });
  await voice.getByTestId("run-example").click();
  const voiceOut = voice.getByTestId("output");
  await expect(voiceOut).toContainText("Пиши — проверю.", { timeout: 240_000 });
  await expect(voiceOut).toContainText("сообщений в истории: 6");

  // урок 11.4: цикл агента — выдуманный моделью Observation ловится, эталон проходит
  const loop = findTask("m11-l4-t3");
  const fake = (loop.task.wrong ?? []).find((w) => w.expect === "выдуманный моделью");
  expect(fake, "в задании m11-l4-t3 должно быть неверное решение с выдуманным Observation").toBeTruthy();
  await openTask(page, "m11-l4-t3");
  await setCode(page, "m11-l4-t3", fake!.code);
  const bad = await checkTask(page, "m11-l4-t3");
  expect(bad.passed).toBe(false);
  expect(bad.text).toContain("выдуманный моделью");
  await setCode(page, "m11-l4-t3", loop.task.solution ?? "");
  const good = await checkTask(page, "m11-l4-t3");
  expect(good.passed, good.text).toBe(true);

  // мини-проект 11.9: помощник по курсу целиком — поиск по n-граммам, порог «не знаю», ответ со ссылкой
  const helper = findTask("m11-l9-t3");
  await openTask(page, "m11-l9-t3");
  await setCode(page, "m11-l9-t3", helper.task.solution ?? "");
  const okHelper = await checkTask(page, "m11-l9-t3");
  expect(okHelper.passed, okHelper.text).toBe(true);
});

test("26. Модуль 12 и контрольная точка 2: спектрограмма записи, поиск названий, CLIP по векторам и инструмент LangChain проверяются в браузере", async ({ page }) => {
  test.setTimeout(480_000);
  // урок 12.5: спектрограмма настоящей записи recording.wav — кадры через broadcasting и окно Ханна, рисунок строится
  await page.goto("/learn/m12-ai-technologies/l05-speech");
  await page.getByRole("tab", { name: /Спектрограмма: частоты во времени/ }).click();
  const spec = page.locator('[data-step]:not([hidden]) [data-testid="runnable-example"]').first();
  await expect(spec).toContainText("np.hanning", { timeout: 60_000 });
  await spec.getByTestId("run-example").click();
  await expect(spec.getByTestId("output")).toContainText("кадров: 340", { timeout: 240_000 });
  await expect(spec.locator('[data-testid="plot-image"]').first()).toBeVisible();

  // урок 12.4: поиск названий подстрокой находит «Meta» внутри «Metan» — понятное сообщение; эталон проходит
  const names = findTask("m12-l4-t3");
  const substring = (names.task.wrong ?? []).find((w) => w.expect === "внутри другого слова");
  expect(substring, "в задании m12-l4-t3 должно быть неверное решение с поиском подстроки").toBeTruthy();
  await openTask(page, "m12-l4-t3");
  await setCode(page, "m12-l4-t3", substring!.code);
  const bad = await checkTask(page, "m12-l4-t3");
  expect(bad.passed).toBe(false);
  expect(bad.text).toContain("внутри другого слова");
  await setCode(page, "m12-l4-t3", names.task.solution ?? "");
  const good = await checkTask(page, "m12-l4-t3");
  expect(good.passed, good.text).toBe(true);

  // мини-проект 12.7: CLIP по готовым векторам 706 картинок — zero-shot проверяется в браузере
  const clip = findTask("m12-l7-t5");
  await openTask(page, "m12-l7-t5");
  await setCode(page, "m12-l7-t5", clip.task.solution ?? "");
  const okClip = await checkTask(page, "m12-l7-t5");
  expect(okClip.passed, okClip.text).toBe(true);

  // контрольная точка 2: инструмент LangChain и tool_calls тестовой модели; неверный tool_call_id объясняется
  const tool = findTask("k2-t18");
  const wrongId = (tool.task.wrong ?? []).find((w) => w.expect === "tool_call_id");
  expect(wrongId, "в задании k2-t18 должно быть неверное решение с чужим tool_call_id").toBeTruthy();
  await openTask(page, "k2-t18");
  await setCode(page, "k2-t18", wrongId!.code);
  const badTool = await checkTask(page, "k2-t18");
  expect(badTool.passed).toBe(false);
  expect(badTool.text).toContain("tool_call_id");
  await setCode(page, "k2-t18", tool.task.solution ?? "");
  const okTool = await checkTask(page, "k2-t18");
  expect(okTool.passed, okTool.text).toBe(true);
});

test("27. Бонус-модуль: необязательный урок, разбор цели lab8, своя логистическая регрессия и своё дерево проверяются в браузере", async ({ page }) => {
  test.setTimeout(480_000);
  // мини-проект Б.7: урок помечен как необязательный; пример обучает два случайных леса в браузере —
  // без кода показателя и единицы доля верных падает с 0,894 до 0,586
  await page.goto("/learn/m13-bonus/l07-mini-project-water");
  await expect(page.getByText("необязательно").first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole("tab", { name: /Что угадывали классификаторы lab8/ }).click();
  const forest = page.locator('[data-step]:not([hidden]) [data-testid="runnable-example"]').first();
  await expect(forest).toContainText("RandomForestClassifier", { timeout: 60_000 });
  await forest.getByTestId("run-example").click();
  await expect(forest.getByTestId("output")).toContainText("лес на всех признаках: 0.894", { timeout: 240_000 });
  await expect(forest.getByTestId("output")).toContainText("лес без кода показателя и единицы: 0.586");

  // Б.7, шаг 2: шпаргалка по коду показателя, построенная по всем строкам, получает сообщение про утечку; эталон проходит
  const cheat = findTask("b1-l7-t2");
  const leak = (cheat.task.wrong ?? []).find((w) => w.expect === "только по train");
  expect(leak, "в задании b1-l7-t2 должно быть неверное решение с утечкой").toBeTruthy();
  await openTask(page, "b1-l7-t2");
  await setCode(page, "b1-l7-t2", leak!.code);
  const bad = await checkTask(page, "b1-l7-t2");
  expect(bad.passed).toBe(false);
  expect(bad.text).toContain("только по train");
  await setCode(page, "b1-l7-t2", cheat.task.solution ?? "");
  const good = await checkTask(page, "b1-l7-t2");
  expect(good.passed, good.text).toBe(true);

  // Б.6: своя логистическая регрессия — шаг по градиенту вместо шага против него объясняется; эталон совпадает со scikit-learn
  const logreg = findTask("b1-l6-t2");
  const sign = (logreg.task.wrong ?? []).find((w) => w.expect === "Знак шага перепутан");
  expect(sign, "в задании b1-l6-t2 должно быть неверное решение с перепутанным знаком шага").toBeTruthy();
  await openTask(page, "b1-l6-t2");
  await setCode(page, "b1-l6-t2", sign!.code);
  const badSign = await checkTask(page, "b1-l6-t2");
  expect(badSign.passed).toBe(false);
  expect(badSign.text).toContain("Знак шага перепутан");
  await setCode(page, "b1-l6-t2", logreg.task.solution ?? "");
  const okLogreg = await checkTask(page, "b1-l6-t2");
  expect(okLogreg.passed, okLogreg.text).toBe(true);

  // Б.6: своё дерево глубины 2 на рекурсии предсказывает так же, как DecisionTreeClassifier
  const tree = findTask("b1-l6-t6");
  await openTask(page, "b1-l6-t6");
  await setCode(page, "b1-l6-t6", tree.task.solution ?? "");
  const okTree = await checkTask(page, "b1-l6-t6");
  expect(okTree.passed, okTree.text).toBe(true);
});

test("28. Долгий сеанс: при переполнении памяти Python перезапускается в безопасной точке, примеры урока и проверка задания продолжают работать", async ({ page }) => {
  test.setTimeout(300_000);
  // порог памяти 1 МБ: его превышает любой ответ Python, поэтому перезапуск срабатывает в каждой безопасной точке
  await page.addInitScript(() => {
    (window as unknown as { __PY_MEMORY_LIMIT_MB: number }).__PY_MEMORY_LIMIT_MB = 1;
  });
  await page.goto("/learn/m01-numpy/l02-ndarray");
  await page.getByRole("tab", { name: /Форма, размер и число осей/ }).click();
  const shape = page.locator('[data-step]:not([hidden]) [data-testid="runnable-example"]').first();
  await expect(shape).toContainText("n_rows, n_features = X.shape", { timeout: 60_000 });
  await shape.getByTestId("run-example").click();
  await expect(shape.getByTestId("output")).toContainText("Записей:", { timeout: 120_000 });

  // пример 4 берёт n_rows из примера 2. Перед запуском Python перезапускается ради памяти, поколение меняется,
  // и пример 2 выполняется заново автоматически — без перезапуска он бы не повторялся
  await page.getByRole("tab", { name: /Номера записей: np.arange/ }).click();
  const arange = page.locator('[data-step]:not([hidden]) [data-testid="runnable-example"]').first();
  await expect(arange).toContainText("np.arange(n_rows)");
  await arange.getByTestId("run-example").click();
  await expect(arange.getByTestId("output")).toContainText("Форма:", { timeout: 120_000 });
  await page.getByRole("tab", { name: /Форма, размер и число осей/ }).click();
  await expect(shape).toContainText("Запущен автоматически");

  // проверка задания: Python снова перезапускается, строка состояния объясняет почему, решение проходит
  const { task } = findTask("m1-l2-t1");
  const card = await openTask(page, "m1-l2-t1");
  await setCode(page, "m1-l2-t1", task.solution ?? "");
  await card.getByTestId("check").click();
  await expect(card.getByTestId("py-memory-restart")).toBeVisible({ timeout: 30_000 });
  const result = card.getByTestId("check-result");
  await expect(result).toBeVisible({ timeout: 120_000 });
  expect(await result.getAttribute("data-passed"), (await result.innerText()).trim()).toBe("true");
});
