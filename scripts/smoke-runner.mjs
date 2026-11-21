// Быстрая проверка runner.py в Node: npm run smoke
import { createNodeEngine } from "./lib/node-engine.mjs";

const t0 = Date.now();
const { execute } = await createNodeEngine({ strict: true });
console.log("engine ready", Date.now() - t0, "ms");

function show(label, res) {
  console.log("\n=== " + label);
  console.log(JSON.stringify(res, (k, v) => (k === "data" && typeof v === "string" ? v.slice(0, 20) + "…" : k === "html" ? v.slice(0, 80) + "…" : v), 1).slice(0, 1500));
}

show("run: print + last expr", await execute({ mode: "run", ns: "t1", code: "x = 2\nprint('x =', x)\nx * 21" }));
show("run: shared ns", await execute({ mode: "run", ns: "t1", code: "x + 1" }));
show("run: numpy + file", await execute({ mode: "run", ns: "t2", files: ["cars.csv"], code: "import numpy as np\nX = np.genfromtxt('cars.csv', delimiter=',', skip_header=1, usecols=[2,4,5,8])\nX.shape" }));
show("run: pandas df", await execute({ mode: "run", ns: "t3", files: ["cars.csv"], code: "import pandas as pd\ndf = pd.read_csv('cars.csv')\ndf.head(3)" }));
show("run: plot", await execute({ mode: "run", ns: "t3", code: "import matplotlib.pyplot as plt\nplt.hist(df['Year'], bins=20)\nplt.title('Год')\nplt.show()\nprint('после графика')" }));
show("run: NameError", await execute({ mode: "run", ns: "t4", code: "pirce = 1\nprint(price)" }));
show("run: KeyError", await execute({ mode: "run", ns: "t3", code: "df['Price']" }));
show("run: broadcast", await execute({ mode: "run", ns: "t2", code: "X[:10, 0] + X[:5, 1]" }));
show("run: syntax", await execute({ mode: "run", ns: "t2", code: "for i in range(3)\n    print(i)" }));
show("run: ambiguous", await execute({ mode: "run", ns: "t2", code: "p = X[:, 3]\nif p > 1000:\n    print('дорого')" }));

const task = {
  mode: "check",
  files: ["cars.csv"],
  prelude: "import numpy as np\nfrom course import load_numeric\nX, names = load_numeric()\nengine = X[:, 2]",
  solution: "missing_engine = int(np.isnan(engine).sum())",
  tests: [
    "v = var('missing_engine', 'number', 'числом')",
    "close(v, ref('missing_engine'), 'Пропусков в объёме двигателя должно быть {expected}, а у вас {actual}.')",
    "close(alt('missing_engine'), alt_ref('missing_engine'), HARDCODE_MSG)",
  ].join("\n"),
};
show("check: correct", await execute({ ...task, code: "missing_engine = np.isnan(engine).sum()" }));
show("check: hardcoded", await execute({ ...task, code: "missing_engine = 205" }));
show("check: wrong", await execute({ ...task, code: "missing_engine = np.isnan(X).sum() + 1" }));
show("check: starter", await execute({ ...task, code: "missing_engine = ..." }));
show("check: error", await execute({ ...task, code: "missing_engine = np.isnan(engin).sum()" }));
show("check: overwrite file then recheck", await execute({ ...task, code: "open('cars.csv','w').write('x')\nmissing_engine = 205" }));
show("check: after overwrite", await execute({ ...task, code: "missing_engine = np.isnan(engine).sum()" }));

const plotTask = {
  mode: "check",
  files: ["cars.csv"],
  prelude: "import numpy as np\nimport matplotlib.pyplot as plt\nfrom course import load_numeric\nX, names = load_numeric()",
  solution: "plt.hist(X[:, 0], bins=10)\nplt.title('Годы')\nplt.xlabel('Год')",
  tests: "ax = axes()\nensure(len(ax.patches) == 10, 'Нужно 10 столбцов, а у вас %d.' % len(ax.patches))\nensure(ax.get_title() != '', 'Добавьте заголовок графика.')\nensure(ax.get_xlabel() == 'Год', 'Подпишите ось X: «Год».')\nr = ref('X')",
};
show("plot ok", await execute({ ...plotTask, code: "plt.hist(X[:, 0], bins=10)\nplt.title('Годы выпуска')\nplt.xlabel('Год')\nplt.show()" }));
show("plot no title", await execute({ ...plotTask, code: "plt.hist(X[:, 0], bins=10)\nplt.xlabel('Год')" }));
const t1 = Date.now();
show("run: sklearn", await execute({ mode: "run", ns: "t5", code: "from sklearn.linear_model import LinearRegression\nimport numpy as np\nm = LinearRegression().fit(np.array([[1],[2],[3]]), [2,4,6])\nm.coef_" }));
console.log("sklearn load+run", Date.now() - t1, "ms");
