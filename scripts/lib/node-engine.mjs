// Движок Python для Node: тот же runner.py и py-engine.js, что и в браузере.
import { loadPyodide } from "pyodide";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createPyEngine } from "../../public/workers/py-engine.mjs";

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

export async function createNodeEngine({ strict = true, quiet = true } = {}) {
  const packageCacheDir = path.join(ROOT, ".cache", "pyodide-packages");
  await fs.mkdir(packageCacheDir, { recursive: true });
  const pyodide = await loadPyodide({
    packageCacheDir,
    stdout: quiet ? () => {} : undefined,
    stderr: quiet ? () => {} : undefined,
  });
  const manifest = path.join(ROOT, "public/py/stubs/manifest.json");
  const stubs = existsSync(manifest) ? JSON.parse(await fs.readFile(manifest, "utf8")) : [];
  const engine = createPyEngine(pyodide, {
    pyBase: path.join(ROOT, "public/py") + "/",
    dataBase: path.join(ROOT, "public/data") + "/",
    stubs,
    fetchText: (p) => fs.readFile(p, "utf8"),
    fetchBinary: async (p) => new Uint8Array(await fs.readFile(p)),
    onStatus: () => {},
  });
  await engine.init();
  const execute = (payload) => engine.execute({ ...payload, strict });
  return { pyodide, engine, execute };
}
