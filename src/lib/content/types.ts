// Типы контента курса. Контент лежит в папке content/ и не требует правки кода.

export type Difficulty = "warmup" | "main" | "star";
export type TaskKind = "code" | "quiz" | "bug" | "predict" | "plot";
export type LessonType = "theory" | "warmup" | "guide" | "project" | "checkpoint" | "competition";

export interface QuizQuestion {
  id: string;
  q: string; // markdown
  code?: string; // показать код в вопросе (для «предскажи вывод»)
  options: string[]; // markdown (инлайн)
  answer: number[]; // индексы правильных ответов
  multiple: boolean;
  ordered?: boolean; // не перемешивать варианты (например, числа по возрастанию)
  explain?: string; // markdown
}

export interface WrongSolution {
  code: string;
  expect: string; // подстрока ожидаемого сообщения проверки
  note?: string;
}

export interface TaskSource {
  id: string;
  title: string;
  kind: TaskKind;
  difficulty: Difficulty;
  introduces: string[];
  uses: string[];
  statement: string; // markdown
  // код
  prelude?: string;
  preludeNote?: string; // откуда эти шаги («это мы делали в модуле 2, урок 5»)
  starter?: string;
  solution?: string;
  explanation?: string; // markdown: построчный разбор решения
  tests?: string;
  files?: string[];
  /** Строка «Столбцы» под условием: по умолчанию — по эталонному решению (columns.ts); список вручную или false — убрать. */
  columns?: string[] | false;
  timeout?: number; // секунды
  wrong?: WrongSolution[];
  alternatives?: string[]; // другие верные решения (должны проходить тесты)
  // квиз
  quiz?: QuizQuestion[];
  hints: string[]; // ровно 3, markdown
}

export interface LessonFrontmatter {
  id: string;
  title: string;
  type?: LessonType;
  duration?: number; // минут чтения
  optional?: boolean;
  sources?: string[];
  introduces?: string[];
  uses?: string[];
  setup?: string; // код, выполняемый перед первым примером урока
  files?: string[]; // датасеты урока
  summary?: string;
  skipTest?: boolean; // урок «можно ли пропустить» (модуль 0)
}

export interface LessonSource extends Required<Omit<LessonFrontmatter, "setup" | "summary" | "skipTest">> {
  setup: string;
  summary: string;
  skipTest: boolean;
  slug: string; // имя папки урока
  moduleSlug: string;
  dir: string; // абсолютный путь к папке
  number: string; // «1.5»
  index: number; // порядковый номер в модуле (с 0)
  body: string; // markdown теории без frontmatter
  tasks: TaskSource[];
}

export interface ModuleSource {
  id: string;
  slug: string;
  number: number;
  label: string; // «Модуль 1», «КТ 1», «Бонус»
  title: string;
  short: string;
  description: string;
  bonus: boolean;
  kind: "module" | "checkpoint" | "competition" | "bonus";
  sources: string[];
  warmupReviews: string[]; // давние понятия, повторённые в разминке модуля
  lessons: LessonSource[];
}

export interface Concept {
  id: string;
  title: string;
  recall: string; // 1–3 строки для карточки «Вспомним» (markdown)
  example?: string; // мини-пример кода
  glossary?: string[]; // id статей справочника
  foundation?: boolean; // базовый Python (модуль 0) — не учитывается в правилах нагрузки
}

export interface GlossaryEntry {
  id: string;
  term: string;
  category: string;
  aliases?: string[];
  summary: string; // markdown
  syntax?: string; // код
  example?: string; // код
  lessons?: string[]; // id уроков
}

export interface Course {
  title: string;
  modules: ModuleSource[];
  concepts: Concept[];
  glossary: GlossaryEntry[];
}

// --- Облегчённые данные для клиента (страницы курса, задачи, профиль) ---
export interface TaskIndexItem {
  id: string;
  title: string;
  kind: TaskKind;
  difficulty: Difficulty;
  lessonId: string;
  moduleId: string;
  href: string;
}

export interface LessonIndexItem {
  id: string;
  title: string;
  number: string;
  type: LessonType;
  optional: boolean;
  duration: number;
  href: string;
  taskIds: string[];
  requiredTaskIds: string[]; // без заданий со звёздочкой
  hasQuiz: boolean;
  examples: number; // запускаемых примеров в теории
}

export interface ModuleIndexItem {
  id: string;
  slug: string;
  number: number;
  label: string;
  title: string;
  short: string;
  description: string;
  kind: ModuleSource["kind"];
  lessons: LessonIndexItem[];
}

export interface CourseIndex {
  modules: ModuleIndexItem[];
  tasks: TaskIndexItem[];
}
