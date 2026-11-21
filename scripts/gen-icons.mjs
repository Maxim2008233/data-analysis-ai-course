// Иконки сайта и приложения (PWA) из логотипа «Лаборатории данных» (BrandMark в src/components/Sidebar.tsx).
// Рисует SVG в Chromium из Playwright (он уже установлен для сквозных тестов) и сохраняет PNG:
//   public/icons/icon-192.png, icon-512.png            — обычные иконки (скруглённый квадрат на прозрачном фоне);
//   public/icons/icon-maskable-192.png, -512.png       — для Android: фон на весь квадрат, рисунок в безопасной зоне;
//   src/app/apple-icon.png (180×180)                   — для iPhone: без прозрачности, углы скругляет сама iOS;
//   src/app/icon.svg, src/app/favicon.ico (16/32/48)   — значок во вкладке браузера.
// Запуск: node scripts/gen-icons.mjs (результат хранится в репозитории, запускать только при смене логотипа).
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

// цвета светлой темы (globals.css): --accent, --warm, --bg-elev
const ACCENT = "#1f4f7a";
const WARM = "#c25e1b";
const ELEV = "#fffcf5";

// рисунок логотипа без фона (координаты в квадрате 40×40); его центр — примерно (20.7, 19.5)
const CHART = `
  <g stroke="${ELEV}" stroke-opacity="0.35" stroke-width="1" fill="none"><path d="M8 31H33M8 31V8"/></g>
  <path d="M9 28 L16 21 L22 24 L31 12" fill="none" stroke="${WARM}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="16" cy="21" r="2.4" fill="${ELEV}"/>
  <circle cx="22" cy="24" r="2.4" fill="${ELEV}"/>
  <circle cx="31" cy="12" r="2.4" fill="${ELEV}"/>`;

/** Как в интерфейсе: скруглённый квадрат, вокруг — прозрачная рамка в 1/40. */
const brandSvg = (size) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 40 40">` +
  `<rect x="1" y="1" width="38" height="38" rx="8" fill="${ACCENT}"/>${CHART}</svg>`;

/** Фон на весь квадрат, рисунок по центру с масштабом scale (для maskable — в круге безопасной зоны 80%). */
const fullBleedSvg = (size, scale) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 40 40">` +
  `<rect width="40" height="40" fill="${ACCENT}"/>` +
  `<g transform="translate(20 20) scale(${scale}) translate(-20.7 -19.5)">${CHART}</g></svg>`;

async function render(page, svg, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

/** ICO с PNG внутри (так умеют все современные браузеры): заголовок, каталог, картинки подряд. */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // зарезервировано
  header.writeUInt16LE(1, 2); // тип: иконка
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach(({ size, png }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o); // ширина
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1); // высота
    dir.writeUInt8(0, o + 2); // палитра
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4); // плоскости
    dir.writeUInt16LE(32, o + 6); // бит на пиксель
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...images.map((x) => x.png)]);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const out = (rel, data) => {
    const file = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
    console.log(`${rel} — ${data.length} байт`);
  };
  for (const size of [192, 512]) {
    out(`public/icons/icon-${size}.png`, await render(page, brandSvg(size), size));
    out(`public/icons/icon-maskable-${size}.png`, await render(page, fullBleedSvg(size, 0.8), size));
  }
  out("src/app/apple-icon.png", await render(page, fullBleedSvg(180, 1), 180));
  out("src/app/icon.svg", brandSvg(40).replace(` width="40" height="40"`, ""));
  const ico = [];
  for (const size of [16, 32, 48]) ico.push({ size, png: await render(page, brandSvg(size), size) });
  out("src/app/favicon.ico", buildIco(ico));
} finally {
  await browser.close();
}
