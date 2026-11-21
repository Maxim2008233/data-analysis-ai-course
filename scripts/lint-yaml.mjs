// Проверка синтаксиса всех YAML-файлов контента (быстро, без загрузки курса).
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
let bad = 0;
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".yaml") || e.name.endsWith(".yml")) check(p, fs.readFileSync(p, "utf8"));
    else if (e.name === "lesson.md") {
      const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(p, "utf8"));
      if (m) check(p + " (frontmatter)", m[1]);
      const body = fs.readFileSync(p, "utf8");
      for (const q of body.matchAll(/```quiz\n([\s\S]*?)```/g)) check(p + " (quiz)", q[1]);
    }
  }
}
function check(p, text) {
  const doc = YAML.parseDocument(text, { prettyErrors: true });
  if (doc.errors.length) {
    bad++;
    console.log("✗", p);
    for (const e of doc.errors) console.log("   ", e.message.split("\n")[0], e.linePos ? `(строка ${e.linePos[0].line})` : "");
  }
}
walk(path.join(process.cwd(), "content"));
console.log(bad ? `YAML с ошибками: ${bad}` : "YAML: ошибок нет");
process.exit(bad ? 1 : 0);
