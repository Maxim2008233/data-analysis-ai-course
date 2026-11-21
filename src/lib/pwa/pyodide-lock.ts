// Какие пакеты Pyodide нужны курсу: импорты из кода → пакеты из pyodide-lock.json → их зависимости.
// Чистые функции: их используют сборка списка файлов для офлайна, страница «Без интернета» и модульные тесты.

export interface PyodideLockPackage {
  name: string;
  file_name: string;
  imports?: string[];
  depends?: string[];
}

export interface PyodideLock {
  packages: Record<string, PyodideLockPackage>;
}

/** Имена пакетов сравниваются без учёта регистра и разницы между «-», «_» и «.» (как в pip). */
const norm = (s: string) => s.toLowerCase().replace(/[-_.]+/g, "-");

/** Файлы пакетов (file_name из lock-файла) для импортов imports вместе со всеми зависимостями. */
export function resolvePyodidePackages(lock: PyodideLock, imports: string[]): string[] {
  const byName = new Map<string, PyodideLockPackage>();
  const byImport = new Map<string, PyodideLockPackage>();
  for (const [key, pkg] of Object.entries(lock.packages ?? {})) {
    byName.set(norm(key), pkg);
    byName.set(norm(pkg.name), pkg);
    for (const imp of pkg.imports ?? []) if (!byImport.has(imp)) byImport.set(imp, pkg);
  }
  const files = new Set<string>();
  const seen = new Set<PyodideLockPackage>();
  const visit = (pkg: PyodideLockPackage | undefined) => {
    if (!pkg || seen.has(pkg)) return;
    seen.add(pkg);
    if (pkg.file_name) files.add(pkg.file_name);
    for (const dep of pkg.depends ?? []) visit(byName.get(norm(dep)));
  };
  for (const imp of imports) visit(byImport.get(imp) ?? byName.get(norm(imp)));
  return [...files].sort();
}

/**
 * Модули верхнего уровня из строк `import a, b.c as d` и `from x.y import z` (относительные импорты пропускаются).
 * Лишнее не страшно: модули, которых нет среди пакетов Pyodide (os, json, учебные заглушки), просто не найдутся.
 */
export function extractImports(code: string): string[] {
  const found = new Set<string>();
  for (const raw of code.split("\n")) {
    const line = raw.replace(/#.*$/, "");
    const from = /^\s*from\s+([A-Za-z_][\w.]*)\s+import\b/.exec(line);
    if (from) {
      found.add(from[1].split(".")[0]);
      continue;
    }
    const imp = /^\s*import\s+(.+)$/.exec(line);
    if (!imp) continue;
    for (const part of imp[1].split(",")) {
      const name = /^\s*([A-Za-z_][\w.]*)/.exec(part);
      if (name) found.add(name[1].split(".")[0]);
    }
  }
  return [...found].sort();
}
