/*
 * Генерация COURSE_MAP.md из реальных метаданных уроков: модуль → урок → исходные файлы → introduces / uses.
 * Запуск: npm run course-map
 * Готовые модули берутся из content/, ещё не созданные — из плана PLANNED ниже (порядок — программа 2026).
 */
import fs from "node:fs";
import path from "node:path";
import { conceptIntroductions, loadCourse } from "../src/lib/content/load";

const ROOT = process.cwd();
const course = loadCourse();
const conceptTitle = new Map(course.concepts.map((c) => [c.id, c.title]));
const foundation = new Set(course.concepts.filter((c) => c.foundation).map((c) => c.id));
const intro = conceptIntroductions(course);

const TYPE: Record<string, string> = {
  theory: "урок",
  lesson: "урок",
  warmup: "разминка",
  project: "мини-проект",
  checkpoint: "проверка",
  guide: "инструкция",
  competition: "соревнование",
};

/** План ещё не созданных модулей (из примерной программы 2026). */
const PLANNED: { label: string; title: string; lessons: string; sources: string }[] = [
  { label: "Модуль 3", title: "Pandas: сводный анализ и оформление таблиц", lessons: "разминка · вопросы аналитика и первичная проверка · describe, среднее vs медиана vs размер группы · groupby и agg · pivot_table, crosstab, число vs доля · оценка цены по группе и понятие метрики (MAE, MAPE) · графики Pandas · Styler · мини-проект на Titanic / Adult", sources: "`Workshops/03_Pandas_сводный_анализ_Styler.ipynb`, `Workshops/2025/03_Pandas_визуализация.ipynb`, `from ODS Course/lesson1_practice_pandas_titanic.ipynb`, `assignment01_adult_pandas.ipynb`" },
  { label: "Модуль 4", title: "Визуализация, BI и Data Story", lessons: "гипотезы; Figure и Axes · читаемый график · гистограммы и интервалы · Seaborn · сравнение категорий · совместное поведение признаков · Plotly · BI-панель и Data Story · мини-проект «история из 3 графиков»", sources: "`Workshops/04_BI_визуализация.ipynb`, `MLtextbook/Глава_2_EDA_Cars.ipynb`" },
  { label: "КТ 1", title: "Контрольная точка по модулям 1–4", lessons: "10–15 задач средней сложности без новых понятий", sources: "—" },
  { label: "Модуль 5", title: "Машинное обучение и первая модель в Scikit-learn", lessons: "задача ML · функция потерь и градиентный спуск · обобщение и переобучение, train/valid/test · DummyRegressor · MAE · линейная регрессия · StandardScaler · RMSE, R², MAPE · мини-проект", sources: "`Lec/02_Машинное_обучение.pptx`, `Lec/03_Модели_ML.pptx`, `Workshops/05_Sklearn_первая_модель.ipynb`, `Workshops/2025/04_SKLearnBasics.ipynb`, `MLtextbook/Глава_3_*`" },
  { label: "Модуль 6", title: "Сравнение моделей и итоговая проверка", lessons: "Pipeline · kNN · дерево решений · ансамбли и случайный лес · сравнение кандидатов · кросс-валидация · мини-проект", sources: "`Workshops/06_Sklearn_сравнение_моделей.ipynb`, `addition/LAB Decision Trees LAST.ipynb`" },
  { label: "Модуль 7", title: "Категориальные признаки, Ridge, градиентный бустинг", lessons: "бинарное и целочисленное кодирование · важность признаков · One-Hot · Target Encoding и утечка · Ridge · LightGBM · итог на test · мини-проект", sources: "`Workshops/07_Категории_Ridge_LightGBM.ipynb`, `addition/lab7 - Car Moldova*.ipynb`, `addition/LAB XGBoost LAST.ipynb`" },
  { label: "Соревнование 1", title: "Оценка цены автомобиля", lessons: "обучение в браузере, отправка прогнозов, MAE на скрытых ответах на сервере", sources: "`Workshops/basic competitions/baseline_hw1.ipynb`" },
  { label: "Модуль 8", title: "Нейронные сети уровня fit/predict", lessons: "нейрон и полносвязная сеть · функции активации · функция потерь · недообучение и переобучение · выбор модели · ★ обратное распространение на NumPy", sources: "`Workshops/08_Neural_Networks_Intro.ipynb`, `addition/lab9_fcnn_in_numpy LAST.ipynb`" },
  { label: "Модуль 9", title: "Большие языковые модели и Hugging Face (Zero-Shot)", lessons: "языковая модель · внимание и трансформер · pipeline · токенизатор · логиты и softmax · zero-shot (CLIP) · соревнование 2", sources: "`Lec/06_LLM.pptx`, `Workshops/09_HF_intro.ipynb`, `Workshops/basic competitions/baseLine_hw2.ipynb`" },
  { label: "Модуль 10", title: "Работа с LLM: промпт-инжиниринг (GigaChat)", lessons: "запрос и параметры · роли и few-shot · function calling · цепочки и шаблоны · соревнование 3 (QA)", sources: "`Workshops/10_PromptEng.ipynb`, `Workshops/2025/06_PromptEng.ipynb`, `Workshops/basic competitions/Baseline_hw3.ipynb`" },
  { label: "Модуль 11", title: "Контекст-инженерия и ИИ-агенты", lessons: "ограничения LLM и RAG · агент и ReAct · инструменты и MCP · контекст-инженерия · боты", sources: "`Lec/07_AI агенты.pptx`, `Workshops/2025/08_Голосовой_бот_Colab.ipynb`" },
  { label: "Модуль 12", title: "Технологии ИИ (обзор)", lessons: "компьютерное зрение · NLP · речь · применения ИИ и риски · мини-проект", sources: "`Lec/08_Технологии_ИИ.pptx`" },
  { label: "КТ 2", title: "Контрольная точка по модулям 5–11", lessons: "две части по 10 задач: модели и нейросети; языковые модели и агенты", sources: "—" },
  { label: "Бонус", title: "Бонус: классификация, PCA, k-means и алгоритмы своими руками", lessons: "разминка · логистическая регрессия · метрики классификации и порог · несбалансированные классы · PCA · k-means · «реализуй сам» на NumPy · мини-проект «загрязнение воды»", sources: "`MLtextbook/Глава_4_*`, `Глава_5_*`, `Глава_6_*`, `addition/lab8 - water-quality_balance.ipynb`, `ml_numpy/*`" },
];

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const plural = (n: number, [one, few, many]: [string, string, string]) => {
  const a = n % 100, b = n % 10;
  return `${n} ${a >= 11 && a <= 14 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many}`;
};
const names = (ids: string[]) => (ids.length ? ids.map((c) => conceptTitle.get(c) ?? c).join(", ") : "—");

let tasksTotal = 0;
let codeTasks = 0;
let maxUses = 0;
const builtLabels = new Set<string>();
const lines: string[] = [];
lines.push("# Карта курса «Анализ данных и искусственный интеллект»");
lines.push("");
lines.push("> Файл генерируется скриптом `npm run course-map` из метаданных уроков (`content/`): модуль → урок → исходные");
lines.push("> файлы → новые понятия (`introduces`) → используемые прошлые понятия (`uses`). Не правьте его вручную.");
lines.push("");

const body: string[] = [];
for (const m of course.modules) {
  builtLabels.add(m.label);
  const nTasks = m.lessons.reduce((n, l) => n + l.tasks.length, 0);
  body.push(`## ${m.label}. ${m.title}`);
  body.push("");
  body.push(esc(m.description));
  body.push("");
  if (m.sources.length) body.push(`**Источники модуля:** ${m.sources.map((s) => "`" + s + "`").join(", ")}`);
  body.push("");
  body.push("| Урок | Тип | Исходные файлы (разделы) | Новые понятия | Используемые прошлые понятия | Заданий |");
  body.push("|---|---|---|---|---|---:|");
  for (const l of m.lessons) {
    const used = new Set<string>([...l.uses]);
    for (const t of l.tasks) {
      tasksTotal++;
      if (t.kind !== "quiz" && t.kind !== "predict") codeTasks++;
      const nf = t.uses.filter((c) => !foundation.has(c));
      maxUses = Math.max(maxUses, nf.length);
      for (const c of t.uses) used.add(c);
    }
    for (const c of l.introduces) used.delete(c);
    const past = [...used].filter((c) => !foundation.has(c));
    const pastText = past
      .map((c) => {
        const w = intro.get(c);
        return `${conceptTitle.get(c) ?? c}${w ? ` (${w.lesson.number})` : ""}`;
      })
      .join(", ");
    const src = l.sources.length ? l.sources.map((s) => esc(s)).join("<br>") : "—";
    body.push(`| ${l.number} ${esc(l.title)}${l.optional ? " *(необяз.)*" : ""} | ${TYPE[l.type] ?? l.type} | ${src} | ${names(l.introduces)} | ${pastText || "—"} | ${l.tasks.length} |`);
  }
  body.push("");
  body.push(`Итого в модуле: ${plural(m.lessons.length, ["урок", "урока", "уроков"])}, ${plural(nTasks, ["задание", "задания", "заданий"])}.`);
  const plan = PLANNED.find((p) => p.label === m.label);
  if (plan) body.push("", `План модуля (программа 2026): ${esc(plan.lessons)}.`);
  body.push("");
}

const theory = course.modules.flatMap((m) => m.lessons).filter((l) => (l.type ?? "theory") === "theory");
const maxIntro = Math.max(...theory.map((l) => l.introduces.length));
lines.push("## Сводка");
lines.push("");
lines.push(`- Модулей с уроками: **${course.modules.length}**, уроков: **${course.modules.reduce((n, m) => n + m.lessons.length, 0)}**, заданий: **${tasksTotal}** (с автопроверкой кода: ${codeTasks}). Модуль, у которого уроков меньше, чем в плане, ещё в работе.`);
lines.push(`- Понятий в реестре: ${course.concepts.length}, статей справочника: ${course.glossary.length}.`);
lines.push(`- Нагрузка на память (проверяется \`npm run validate\`): теоретический урок вводит не больше ${maxIntro} понятий (норма — 1–3); в \`uses\` задания не больше ${maxUses} прошлых понятий (норма — до 3); прошлые понятия — из текущего или 1–2 предыдущих модулей либо повторены в разминке.`);
lines.push("");
lines.push(...body);

lines.push("## Модули по плану (ещё не созданы)");
lines.push("");
lines.push("| Модуль | Уроки | Исходные файлы |");
lines.push("|---|---|---|");
for (const p of PLANNED) {
  if (builtLabels.has(p.label)) continue;
  lines.push(`| **${p.label}. ${esc(p.title)}** | ${esc(p.lessons)} | ${esc(p.sources)} |`);
}
lines.push("");
lines.push("## Датасеты сайта");
lines.push("");
lines.push("| Файл | Откуда | Где используется |");
lines.push("|---|---|---|");
lines.push("| `cars.csv` (41 007 строк) | `Workshops/cars.csv` | модули 0–2 |");
lines.push("| `cars_processed.csv` (32 067 строк, 15 колонок) | результат модуля 2; собирается `npm run data:build` в Pyodide и совпадает с `Workshops/cars_processed.csv` по исходным колонкам | модуль 2 (уроки 2.10–2.11), модули 3–8, КТ 2, бонус (уроки Б.0–Б.6) |");
lines.push("| `cars_preprocessing_log.csv` | журнал обработки модуля 2 (тот же скрипт) | справка |");
lines.push("| `titanic.csv` (891 строка) | `from ODS Course/` — обучающая часть набора «Титаник» | мини-проекты модулей 3 и 8 |");
lines.push("| `adult.csv` (32 561 строка) | `from ODS Course/` — перепись США 1994 года (Adult) | модуль 3 (звёздное задание), мини-проекты модулей 4 и 7, урок 12.6 (ошибки модели по группам) |");
lines.push("| `diabetes.csv` (442 строки, 11 колонок) | scikit-learn: `load_diabetes(scaled=False)` — данные Efron и др., 2004 | мини-проекты модулей 5 и 6, КТ 2 |");
lines.push("| `moons.csv` (1 000 строк: x1, x2, label) | scikit-learn: `make_moons(n_samples=1000, noise=0.25, random_state=100)` — как в `Workshops/08_Neural_Networks_Intro.ipynb`; собирается `npm run data:build` | урок 8.7, КТ 2 |");
lines.push("| `competition_cars_train.csv` (7 195 строк, 14 колонок) | `Workshops/basic competitions/cars_train.csv`: обучающая часть соревнования 1 — с повторами, пропусками и ошибочными ценами; собирается `npm run data:build` | соревнование 1 |");
lines.push("| `competition_cars_test.csv` (1 856 строк, без цены) | тот же файл: проверочная часть — группы повторов не пересекаются с обучающей, цены 1 000–500 000; ответы — только в `private/competitions/cars-price/answers.json` (сервер) | соревнование 1 |");
lines.push("| `course_texts.txt` (1 565 абзацев) | связный текст уроков модулей 0–8 без кода и формул, снимок 16 ноября 2026; собирается `scripts/data/build_course_corpus.py` | уроки 9.0–9.2 |");
lines.push("| `reviews.csv` (88 отзывов: text, label, domain, lang) | написаны для курса (`scripts/hf/reviews.py`): кино, еда, товары, отели, сервисы, «хитрые» с отрицаниями и сарказмом, фразы из `Workshops/09_HF_intro.ipynb`, 8 русских | уроки 9.0, 9.4–9.6, КТ 2 |");
lines.push("| `distilbert_vocab.txt` (30 522 токена) | словарь токенизатора `distilbert-base-uncased-finetuned-sst-2-english`; токенизатор WordPiece работает в браузере по-настоящему | уроки 9.4–9.6 |");
lines.push("| `sst2_logits.json` | логиты той же модели для 88 отзывов — посчитаны настоящей библиотекой transformers (`scripts/hf/build_hf_data.py`), сверены `scripts/hf/verify_stub.py` | уроки 9.4–9.6, КТ 2 |");
lines.push("| `distilbert_attention.npz` | настоящие веса внимания всех 72 голов той же модели для двух фраз | урок 9.3 |");
lines.push("| `zs_public.csv`, `zs_public.npy` (706 картинок, векторы 512) | открытая половина картинок соревнования «Zero-shot классификация изображений» (`Workshops/basic competitions/ZS CLF comp.zip`), по 2 на класс; векторы CLIP ViT-B/32; вторая половина и её ответы — только для соревнования 2 | уроки 9.7–9.10, 12.1, 12.7 |");
lines.push("| `zs_prompts.npz` (349 классов × 10 подписей) | подписи-промпты классов (названия, перевод, шаблоны) и их векторы CLIP; переводы — `scripts/hf/class_names.py` | уроки 9.2, 9.7–9.10, 11.0, 12.7 |");
lines.push("| `zs_thumbs.npz` (54 миниатюры 64 × 64) | уменьшенные копии части открытых картинок | уроки 9.7, 12.1–12.2 |");
lines.push("| `competition_zs_test.csv`, `competition_zs_test.npy` (706 картинок: ID, group, language; векторы 512) | скрытая половина картинок соревнования под новыми ID `t001`–`t706` в перемешанном порядке, без классов; собирается `scripts/hf/build_hf_data.py competition`; классы — только в `private/competitions/zero-shot/answers.json` (сервер) | соревнование 2 |");
lines.push("| `competition_zs_sample_submission.csv` | пример файла ответов: ID и `predicted_class` | соревнование 2 |");
lines.push("| `gigachat_notebook.json` (12 записей) | ответы GigaChat, напечатанные в `Workshops/10_PromptEng.ipynb` (= `Workshops/2025/06_PromptEng.ipynb`), вместе с запросами, которые их вызвали; собирается `scripts/llm/build_llm_data.py` | модуль 10 |");
lines.push("| `qa_train.csv` (87 вопросов), `qa_test.csv` (786), `qa_gigachat_baseline.csv` (786 прогнозов) | соревнование «QA» (`Workshops/basic competitions`): вопросы, варианты, категории, номер ответа (только в обучающей части) и ответы базового решения на GigaChat; тот же скрипт | модуль 10, соревнование 3 |");
lines.push("| `course_docs.json` (729 разделов), `course_queries.json` (234 запроса), `course_glossary.json` (242 статьи) | база знаний модуля 11 — разделы уроков 0.1–10.9 без кода и формул, названия статей справочника с уроком, где вводится понятие; собирается `npx tsx scripts/llm/build_course_docs.ts` | уроки 11.0–11.3, 11.4, 11.7, 11.9, 12.3–12.5, 12.7, КТ 2 |");
lines.push("| `assistant_questions.json` (60 вопросов) | размечены авторами сайта: 30 вопросов по курсу с уроками, где есть ответ, и 30 не по курсу; половины dev (подбор порога) и test (итоговая оценка) | уроки 11.3, 11.9, 12.7, КТ 2 |");
lines.push("| `water_polution.csv` (19 921 строка, 21 столбец) | `addition/water_polution.csv` — набор лабораторной lab8: среднегодовые значения 182 показателей воды (19 единиц) в 2 906 водоёмах Европы и показатели стран (плотность населения, туристы, состав мусора); столбцы исходного `addition/waterPollution.csv` названы как в базе Waterbase Европейского агентства по окружающей среде | урок Б.7 |");
lines.push("| `recording.wav` (3,42 с, 48 000 Гц, моно, 16 бит), `voice_bot_notebook.json` (4 ответа SaluteSpeech, 3 ответа GigaChat) | `Workshops/2025/08_Голосовой_бот_Colab.ipynb`: запись и напечатанные ответы сервисов, диалог голосового чата; собирается `scripts/llm/build_llm_data.py` | уроки 11.8, 12.5 |");
lines.push("");

fs.writeFileSync(path.join(ROOT, "COURSE_MAP.md"), lines.join("\n"));
console.log(`COURSE_MAP.md: модулей ${course.modules.length}, заданий ${tasksTotal}`);
