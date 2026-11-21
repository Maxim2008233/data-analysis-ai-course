// Настройки сайта, которые удобно менять в одном месте.

/** Ссылка «Нашли ошибку?» в шапке и подвале. Подставьте свой адрес (форма, issues на GitHub, почта). */
export const REPORT_BUG_URL = process.env.NEXT_PUBLIC_REPORT_BUG_URL || "https://github.com/Maxim2008233/data-analysis-ai-course/issues/new";

export const SITE_NAME = "Лаборатория данных";
export const SITE_SHORT = "Лаборатория данных";
export const SITE_DESCRIPTION =
  "Интерактивный курс «Анализ данных и искусственный интеллект»: теория, Python прямо в браузере и задания с автопроверкой на данных об автомобилях.";

/** Версия Pyodide (Python в браузере). Должна совпадать с public/workers/py-worker.js и package.json. */
export const PYODIDE_VERSION = "314.0.7";

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

/** Показать кнопку «Показать решение» после стольких неудачных попыток (или после всех подсказок). */
export const ATTEMPTS_BEFORE_SOLUTION = 3;

export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "dev";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
export const AUTH_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
