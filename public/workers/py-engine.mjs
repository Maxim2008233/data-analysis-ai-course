/*
 * Общий «движок» Python для сайта: используется и в Web Worker (браузер), и в Node (scripts/validate-content).
 * Не зависит от окружения: всё, что связано с сетью/файлами, передаётся через опции.
 *
 *   const engine = createPyEngine(pyodide, { fetchText, fetchBinary, onStatus, pyBase, dataBase, stubs });
 *   await engine.init();
 *   const res = await engine.execute({ mode: 'run' | 'check', ..., files: ['cars.csv'] });
 *   engine.memoryBytes();   // сколько памяти занял движок (для перезапуска при переполнении)
 */
// Пакеты, которых нет в сборке Pyodide: ставятся через micropip с PyPI.
// Версии зафиксированы: проверены валидатором контента (seaborn 0.13.2, plotly 7.1.0 ↔ plotly.js 4.1.1 на странице).
var MICROPIP_PACKAGES = {
  seaborn: "seaborn==0.13.2",
  plotly: "plotly==7.1.0",
};

var PY_LIB_DIR = "/home/pyodide/lib";
var DATA_DIR = "/home/pyodide/data";

export function createPyEngine(pyodide, opts) {
  var onStatus = opts.onStatus || function () {};
  var writtenFiles = {};
  var micropipInstalled = {};
  var handle = null;
  var stubsLoaded = false;

  function status(text) {
    try {
      onStatus(text);
    } catch {
      /* ignore */
    }
  }

  async function writePyModule(name, source) {
    pyodide.FS.mkdirTree(PY_LIB_DIR);
    pyodide.FS.writeFile(PY_LIB_DIR + "/" + name, source);
  }

  async function init() {
    status("Готовим Python…");
    var files = opts.pyFiles || ["runner.py", "course.py"];
    for (var i = 0; i < files.length; i++) {
      var src = await opts.fetchText(opts.pyBase + files[i]);
      await writePyModule(files[i], src);
    }
    pyodide.runPython(
      "import sys\n" +
        "if '" + PY_LIB_DIR + "' not in sys.path:\n" +
        "    sys.path.insert(0, '" + PY_LIB_DIR + "')\n" +
        "import runner\n" +
        "runner.init()\n"
    );
    handle = pyodide.globals.get("runner").handle;
    pyodide.FS.mkdirTree(DATA_DIR);
  }

  async function loadStubs() {
    // Учебные заглушки (transformers, gigachat): пакеты в /home/pyodide/lib
    if (stubsLoaded || !opts.stubs) return;
    var list = typeof opts.stubs === "function" ? await opts.stubs() : opts.stubs;
    for (var i = 0; i < list.length; i++) {
      var rel = list[i];
      var src = await opts.fetchText(opts.pyBase + "stubs/" + rel);
      var full = PY_LIB_DIR + "/" + rel;
      pyodide.FS.mkdirTree(full.substring(0, full.lastIndexOf("/")));
      pyodide.FS.writeFile(full, src);
    }
    stubsLoaded = true;
  }

  async function ensurePackages(code) {
    if (!code) return;
    // Pandas Styler (`df.style`) нужен jinja2, а цветовым шкалам — matplotlib: явного import в коде нет
    if (/\.style\b/.test(code) && !/^\s*import jinja2/m.test(code)) code += "\nimport jinja2\nimport matplotlib\n";
    // пакеты Pyodide по import-ам
    try {
      await pyodide.loadPackagesFromImports(code, {
        messageCallback: function (msg) {
          var m = /Loading (.+)/.exec(msg);
          if (m) status("Загружаем библиотеки: " + m[1]);
        },
        errorCallback: function () {},
      });
    } catch {
      // синтаксическая ошибка в коде — её покажет runner
    }
    // пакеты через micropip (чистый Python с PyPI)
    var mods = [];
    Object.keys(MICROPIP_PACKAGES).forEach(function (mod) {
      var re = new RegExp("(^|\\n)\\s*(import|from)\\s+" + mod + "\\b");
      if (re.test(code) && !micropipInstalled[mod]) mods.push(mod);
    });
    if (mods.length) {
      status("Устанавливаем библиотеки: " + mods.join(", ") + "…");
      await pyodide.loadPackage("micropip");
      var micropip = pyodide.pyimport("micropip");
      await micropip.install(
        mods.map(function (m) {
          return MICROPIP_PACKAGES[m];
        })
      );
      mods.forEach(function (m) {
        micropipInstalled[m] = true;
      });
    }
  }

  async function ensureFiles(files) {
    files = files || [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (writtenFiles[f]) continue;
      status("Загружаем данные: " + f);
      var bytes = await opts.fetchBinary(opts.dataBase + f);
      pyodide.FS.writeFile(DATA_DIR + "/" + f, bytes);
      writtenFiles[f] = true;
    }
  }

  function collectCode(payload) {
    return [payload.setup, payload.prelude, payload.code, payload.solution, payload.tests]
      .filter(Boolean)
      .join("\n");
  }

  async function prepare(payload) {
    var code = collectCode(payload);
    if (payload.stubs || /\b(transformers|gigachat|langchain_gigachat|langchain_core|langchain)\b/.test(code)) await loadStubs();
    await ensureFiles(payload.files);
    await ensurePackages(code);
  }

  function executeSync(payload) {
    var json = handle(JSON.stringify(payload));
    return JSON.parse(json);
  }

  /** Память wasm-движка, байт. Она только растёт; null — если узнать нельзя (внутреннее поле Pyodide). */
  function memoryBytes() {
    try {
      return pyodide._module.HEAPU8.length;
    } catch {
      return null;
    }
  }

  async function execute(payload, onStarted) {
    if (!handle) await init();
    await prepare(payload);
    if (onStarted) onStarted();
    status("");
    return executeSync(payload);
  }

  return {
    init: init,
    prepare: prepare,
    execute: execute,
    executeSync: executeSync,
    memoryBytes: memoryBytes,
    ensureFiles: ensureFiles,
    ensurePackages: ensurePackages,
  };
}
