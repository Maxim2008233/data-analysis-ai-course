// Выполнить Python-файл в той же среде, что и сайт (Pyodide), и показать вывод.
// Использование: node scripts/py-eval.mjs file.py [cars.csv другие_файлы...]
import fs from "node:fs";
import { createNodeEngine } from "./lib/node-engine.mjs";

const [file, ...files] = process.argv.slice(2);
const code = fs.readFileSync(file, "utf8");
const { execute } = await createNodeEngine({ strict: true });
const res = await execute({ mode: "run", ns: "eval", code, files: files.length ? files : ["cars.csv"] });
for (const o of res.outputs) {
  if (o.type === "text") process.stdout.write((o.stream === "stderr" ? "[stderr] " : "") + o.text);
  else if (o.type === "html") process.stdout.write("[html " + o.html.length + " chars]\n");
  else if (o.type === "image") process.stdout.write("[image]\n");
  else process.stdout.write("[" + o.type + "]\n");
}
if (res.error) {
  console.log("ERROR:", res.error.title, "|", res.error.message);
  console.log(res.error.traceback);
}
