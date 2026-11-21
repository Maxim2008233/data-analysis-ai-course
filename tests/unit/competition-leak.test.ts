// Скрытые ответы соревнований не должны попадать туда, откуда их может получить браузер:
// в public/ (раздаётся как есть) и в клиентские файлы сборки .next/static (если сборка есть).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const answersDir = path.join(ROOT, "private/competitions");

function files(dir: string, exts: string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...files(p, exts));
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(p);
  }
  return out;
}

const competitions = fs.existsSync(answersDir) ? fs.readdirSync(answersDir).filter((d) => fs.existsSync(path.join(answersDir, d, "answers.json"))) : [];

describe("скрытые ответы соревнований", () => {
  it("ответы есть только в private/", () => {
    expect(competitions.length).toBeGreaterThan(0);
  });

  for (const id of competitions) {
    const answers = JSON.parse(fs.readFileSync(path.join(answersDir, id, "answers.json"), "utf8")) as {
      ids: (number | string)[];
      prices?: number[];
      classes?: string[];
      answers?: number[];
    };
    // «отпечатки» — несколько первых ответов подряд в тех форматах, в которых их можно случайно выложить:
    // цены через запятую (соревнование 1); классы скрытых картинок подряд и пары «ID,класс» (соревнование 2)
    // номера вариантов (соревнование 3) — длинные серии подряд: короткие серии из 0–3 встречаются где угодно
    const prints: string[] = answers.answers
      ? [answers.answers.slice(0, 24).join(","), answers.answers.slice(0, 24).join(", "), answers.answers.slice(100, 124).join(",")]
      : answers.prices
      ? [answers.prices.slice(0, 8).join(",")]
      : [
          answers.classes!.slice(0, 4).join('","'),
          answers.classes!.slice(0, 4).join("', '"),
          `\n${answers.ids[0]},${answers.classes![0]},`,
          `\n${answers.ids[0]},${answers.classes![0]}\n`,
        ];

    it(`${id}: ответов нет в public/`, () => {
      for (const f of files(path.join(ROOT, "public"), [".json", ".js", ".mjs", ".csv", ".py", ".txt"])) {
        const text = fs.readFileSync(f, "utf8");
        for (const p of prints) expect(text.includes(p), `отпечаток ответов найден в ${path.relative(ROOT, f)}`).toBe(false);
      }
    });

    if (answers.prices) {
      const fingerprintCsv = answers.prices.slice(0, 3).map((p) => `\n${p},`).join("");
      it(`${id}: в проверочной таблице нет цены`, () => {
        const header = fs.readFileSync(path.join(ROOT, "public/data/competition_cars_test.csv"), "utf8").split("\n")[0];
        expect(header.split(",")).not.toContain("Price");
        const sample = fs.readFileSync(path.join(ROOT, "public/data/competition_cars_sample_submission.csv"), "utf8");
        expect(sample.includes(fingerprintCsv)).toBe(false);
      });
    }

    it(`${id}: ответов нет в клиентских файлах сборки (.next/static)`, () => {
      const chunks = files(path.join(ROOT, ".next/static"), [".js"]);
      for (const f of chunks) {
        const text = fs.readFileSync(f, "utf8");
        for (const p of prints) expect(text.includes(p), `отпечаток ответов найден в ${path.relative(ROOT, f)}`).toBe(false);
      }
    });
  }
});
