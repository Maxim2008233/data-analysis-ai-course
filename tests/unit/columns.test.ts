// Строка «Столбцы» под условием задания: какие столбцы берёт эталонное решение (src/lib/content/columns.ts).
import { describe, expect, it } from "vitest";
import { loadColumnDictionary, matrixColumnIndices, stringLiterals, taskColumns } from "@/lib/content/columns";
import { loadCourse } from "@/lib/content/load";
import type { LessonSource, TaskSource } from "@/lib/content/types";

const dict = loadColumnDictionary();
const task = (solution: string, extra: Partial<TaskSource> = {}): TaskSource =>
  ({ id: "t", title: "t", kind: "code", difficulty: "main", introduces: [], uses: [], statement: "", hints: [], files: [], solution, ...extra }) as TaskSource;
const lesson = (setup = "", files: string[] = ["cars.csv"]): Pick<LessonSource, "setup" | "files"> => ({ setup, files });

describe("номера столбцов матрицы X", () => {
  it.each([
    ["price = X[:, 3]", [3]],
    ["block = X[10:15, [0, 3]]", [0, 3]],
    ["cheap = X[X[:, 0] > 2010, 3]", [0, 3]], // по порядку появления в коде
    ["pair = X[:, 1:3]", [1, 2]],
    ["last = X[:, -1]", [3]],
    ["row = X[0]", []], // строка, а не столбец
    ["v = data[:, 2]", []], // другая матрица
    ["x = X[100, 1]\ny = X[100, 1]", [1]], // без повторов
  ] as const)("%s → %j", (code, expected) => {
    expect(matrixColumnIndices(code, 4)).toEqual(expected);
  });
});

describe("строковые литералы", () => {
  it("обычные и r-строки — да, f- и b-строки — нет; кавычки в комментариях и тройные кавычки не мешают", () => {
    expect(stringLiterals(`df['Year'] + df["Price(euro)"] + f'{x}' + r'\\d' + b'raw'`)).toEqual(["Year", "Price(euro)", "\\d"]);
    expect(stringLiterals("x = 1  # don't\ny = df['Make']")).toEqual(["Make"]);
    expect(stringLiterals('"""doc \'Year\' text"""\nz = df[\'Style\']')).toEqual(["doc 'Year' text", "Style"]);
    expect(stringLiterals("s = 'it\\'s'")).toEqual(["it\\'s"]);
  });
});

describe("taskColumns", () => {
  it("Pandas: столбцы датасета задания по порядку появления, с описаниями", () => {
    const cols = taskColumns(task("m = df[df['Year'] > 2010]['Price(euro)'].mean()\nprint('Year')"), lesson(), dict);
    expect(cols).toEqual({
      items: [
        { name: "Year", dataset: "cars.csv", label: "год выпуска" },
        { name: "Price(euro)", dataset: "cars.csv", label: "цена, евро" },
      ],
    });
  });

  it("описание берётся из датасета задания: Price после обработки, Age — у машин и у пассажиров разное", () => {
    expect(taskColumns(task("df['Price'].median()", { files: ["cars_processed.csv"] }), lesson(), dict)?.items[0].label).toBe("цена, евро");
    expect(taskColumns(task("df['Age'].mean()", { files: ["titanic.csv"] }), lesson(), dict)?.items[0].label).toBe("возраст, лет");
    expect(taskColumns(task("df['Age'].mean()", { files: ["cars_processed.csv"] }), lesson(), dict)?.items[0].label).toMatch(/возраст автомобиля/);
  });

  it("NumPy: номера столбцов X из load_numeric() с названиями", () => {
    const cols = taskColumns(task("block = X[10:15, [0, 3]]", { prelude: "X, names = load_numeric()" }), lesson(), dict);
    expect(cols?.matrix).toBe("X");
    expect(cols?.items.map((it) => [it.index, it.name, it.label])).toEqual([
      [0, "Year", "год выпуска"],
      [3, "Price(euro)", "цена, евро"],
    ]);
  });

  it("NumPy: матрица из np.genfromtxt с usecols", () => {
    const setup = "X = np.genfromtxt('cars.csv', delimiter=',', skip_header=1, usecols=[2, 4, 5, 8], dtype=float)";
    expect(taskColumns(task("d = X[:, 1]"), lesson(setup), dict)?.items.map((it) => it.name)).toEqual(["Distance"]);
  });

  it("columns: false убирает строку, список задаёт столбцы вручную", () => {
    expect(taskColumns(task("df['Year']", { columns: false }), lesson(), dict)).toBeNull();
    expect(taskColumns(task("df.iloc[:, 0]", { columns: ["Make"] }), lesson(), dict)?.items.map((it) => it.name)).toEqual(["Make"]);
  });

  it("без столбцов данных строки нет", () => {
    expect(taskColumns(task("x = [1, 2, 3]\nprint(sum(x))"), lesson(), dict)).toBeNull();
  });
});

describe("задания курса", () => {
  const course = loadCourse();
  const all = course.modules.flatMap((m) => m.lessons.flatMap((l) => l.tasks.map((t) => ({ t, l, cols: taskColumns(t, l, dict) }))));
  const byId = (id: string) => all.find((x) => x.t.id === id)!;

  it("1.3.3 (скриншот ученика): номера 0 и 3 матрицы X — год и цена", () => {
    const { cols } = byId("m1-l3-t3");
    expect(cols?.items.map((it) => `${it.index} ${it.name}`)).toEqual(["0 Year", "3 Price(euro)"]);
  });

  it("2.5.3: год выпуска и пробег", () => {
    expect(byId("m2-l5-t3").cols?.items.map((it) => it.name)).toEqual(expect.arrayContaining(["Year", "Distance"]));
  });

  it("у каждого показанного столбца есть описание, строка есть почти у всех заданий с таблицами", () => {
    const shown = all.filter((x) => x.cols);
    expect(shown.length).toBeGreaterThan(250);
    const unlabeled = shown.flatMap((x) => x.cols!.items.filter((it) => !it.label).map((it) => `${x.t.id}: ${it.name}`));
    expect(unlabeled).toEqual([]);
  });
});
