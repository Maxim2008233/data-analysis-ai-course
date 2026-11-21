import type { MetadataRoute } from "next";
import { APP_SHORT_NAME, SITE_DESCRIPTION, SITE_NAME, THEME_COLOR_LIGHT } from "@/lib/config";

// Манифест веб-приложения (PWA): название, иконки и вид при установке на телефон или компьютер.
// Next.js отдаёт его по адресу /manifest.webmanifest и сам добавляет <link rel="manifest"> на все страницы.
// Иконки рисует scripts/gen-icons.mjs. background_color — фон заставки при запуске установленного приложения.
// theme_color нарочно НЕТ: Chrome на Android красит им нижнюю системную панель установленного приложения
// (WebappIntentDataProvider в Chromium), а тёмного варианта из манифеста не читает — в тёмной теме панель была бы
// светлой. Без theme_color панель следует светлой или тёмной теме телефона. Цвет строки состояния сверху задают
// теги <meta name="theme-color"> (layout.tsx и ThemeColorSync — по теме сайта).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: `${SITE_NAME} — курс «Анализ данных и ИИ»`,
    short_name: APP_SHORT_NAME,
    description: SITE_DESCRIPTION,
    lang: "ru",
    dir: "ltr",
    // установленное приложение открывается на оглавлении курса с кнопкой «Продолжить»
    start_url: "/course",
    scope: "/",
    display: "standalone",
    background_color: THEME_COLOR_LIGHT,
    categories: ["education"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // долгое нажатие на иконку (Android, Windows)
    shortcuts: [
      { name: "Продолжить курс", short_name: "Продолжить", url: "/course", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Все задачи", short_name: "Задачи", url: "/tasks", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Справочник", url: "/reference", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
