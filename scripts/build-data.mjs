// Сборка производных датасетов курса в Pyodide (та же среда, что и на сайте).
//   • public/data/cars_processed.csv и cars_preprocessing_log.csv из cars.csv (модуль 2);
//   • moons.csv — «два полумесяца» для урока 8.7 (make_moons, как в ноутбуке модуля 8);
//   • данные соревнования 1: обучающая и проверочная части в public/data, ответы — в private/ (только для сервера).
// Вход берётся из public/data (строка) или из любого файла проекта ({ from, as }); выход — в public/data (строка)
// или в указанную папку ({ file, to }).
import fs from "node:fs";
import path from "node:path";
import { createNodeEngine, ROOT } from "./lib/node-engine.mjs";

const WORK = "/home/pyodide/work";
const COMP = "private/competitions/cars-price";

const JOBS = [
  { script: "scripts/data/build_cars_processed.py", inputs: ["cars.csv"], outputs: ["cars_processed.csv", "cars_preprocessing_log.csv"] },
  { script: "scripts/data/build_moons.py", inputs: [], outputs: ["moons.csv"] },
  {
    script: "scripts/data/build_competition_cars.py",
    inputs: [{ from: `${COMP}/source/cars_train.csv`, as: "cars_train.csv" }],
    outputs: [
      "competition_cars_train.csv",
      "competition_cars_test.csv",
      "competition_cars_sample_submission.csv",
      { file: "answers.json", to: COMP },
    ],
  },
];

const only = process.argv[2]; // необязательно: часть имени скрипта, например «competition»
const { execute, pyodide } = await createNodeEngine({ strict: true });
pyodide.FS.mkdirTree(WORK);
for (const job of JOBS) {
  if (only && !job.script.includes(only)) continue;
  const staged = [];
  for (const input of job.inputs) {
    if (typeof input === "string") staged.push(input);
    else pyodide.FS.writeFile(`${WORK}/${input.as}`, fs.readFileSync(path.join(ROOT, input.from)));
  }
  const code = fs.readFileSync(path.join(ROOT, job.script), "utf8");
  const res = await execute({ mode: "run", ns: "build", reset: true, code, files: staged });
  for (const o of res.outputs) if (o.type === "text") process.stdout.write(o.text);
  if (res.error) {
    console.error("Ошибка:", res.error.title, res.error.message, "\n", res.error.traceback);
    process.exit(1);
  }
  for (const out of job.outputs) {
    const file = typeof out === "string" ? out : out.file;
    const dir = typeof out === "string" ? "public/data" : out.to;
    const data = pyodide.FS.readFile(`${WORK}/${file}`);
    fs.mkdirSync(path.join(ROOT, dir), { recursive: true });
    fs.writeFileSync(path.join(ROOT, dir, file), data);
    console.log(`записан ${dir}/${file}`, data.length, "байт");
  }
}
