// Настройки сайта, которые удобно менять в одном месте.

/** Ссылка «Нашли ошибку?» в шапке и подвале. Подставьте свой адрес (форма, issues на GitHub, почта). */
export const REPORT_BUG_URL = process.env.NEXT_PUBLIC_REPORT_BUG_URL || "https://github.com/Maxim2008233/data-analysis-ai-course/issues/new";

export const SITE_NAME = "Лаборатория данных";
export const SITE_SHORT = "Лаборатория данных";
/** Подпись под иконкой установленного приложения (на экране телефона помещается около 12 символов). */
export const APP_SHORT_NAME = "Лаб. данных";
/** Фон страницы светлой и тёмной темы (--bg в globals.css): цвет строки состояния телефона и панели браузера. */
export const THEME_COLOR_LIGHT = "#f4efe4";
export const THEME_COLOR_DARK = "#0f1726";
export const SITE_DESCRIPTION =
  "Интерактивный курс «Анализ данных и искусственный интеллект»: теория, Python прямо в браузере и задания с автопроверкой на данных об автомобилях.";

/** Версия Pyodide (Python в браузере). Должна совпадать с public/workers/py-worker.mjs и package.json. */
export const PYODIDE_VERSION = "314.0.7";
/** Откуда загружается Pyodide (тот же адрес — в public/workers/py-worker.mjs). */
export const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
/** Файлы самого Pyodide, которые загружаются при запуске Python (без пакетов). */
export const PYODIDE_CORE_FILES = ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"];
/** Пакеты, которые ставятся через micropip с PyPI (их версии — в MICROPIP_PACKAGES в public/workers/py-engine.mjs). */
export const PY_MICROPIP_MODULES = ["seaborn", "plotly"];
/** plotly.js для интерактивных графиков (версия согласована с пакетом plotly, см. py-engine.mjs). */
export const PLOTLY_SRC = "https://cdn.jsdelivr.net/npm/plotly.js-dist-min@4.1.1/plotly.min.js";

/** Таймауты выполнения кода, секунды. */
export const RUN_TIMEOUT_S = 20;
export const CHECK_TIMEOUT_S = 40;

/**
 * Порог памяти Python в браузере, МБ. Память движка Pyodide только растёт. Если после выполнения она больше порога,
 * Python перезапускается в ближайшей безопасной точке — перед запуском или проверкой задания, отправкой решения
 * соревнования или запуском примера урока (предыдущие примеры урока тогда выполняются заново автоматически).
 * В долгом прогоне валидатора курса память доходила до 1,5–2 ГБ, и Pyodide начинал возвращать испорченные ответы.
 */
export const PY_MEMORY_LIMIT_MB = 1024;
/**
 * Тот же порог для телефонов, планшетов и компьютеров с памятью до 4 ГБ: на iPhone система закрывает вкладку,
 * которой не хватает памяти, раньше, чем на компьютере. Если сразу после перезапуска ради памяти Python снова
 * занимает больше порога (тяжёлые библиотеки), следующий перезапуск будет только после роста ещё на 25 %.
 */
export const PY_MEMORY_LIMIT_MOBILE_MB = 640;

/** Показать кнопку «Показать решение» после стольких неудачных попыток (или после всех подсказок). */
export const ATTEMPTS_BEFORE_SOLUTION = 3;

export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "dev";

/**
 * Офлайн-режим и установка как приложения (service worker public/sw.js). Выключается переменной окружения
 * NEXT_PUBLIC_PWA=off при сборке: тогда страницы удаляют уже установленный service worker и его кэши (DEPLOY.md).
 */
export const PWA_ENABLED = process.env.NEXT_PUBLIC_PWA !== "off";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
export const AUTH_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
