import type { MetadataRoute } from "next";
import { APP_SHORT_NAME, SITE_DESCRIPTION, SITE_NAME } from "@/lib/config";

// Манифест веб-приложения (PWA): название, иконки и вид при установке на телефон или компьютер.
// Next.js отдаёт его по адресу /manifest.webmanifest и сам добавляет <link rel="manifest"> на все страницы.
// Иконки рисует scripts/gen-icons.mjs. Цвета — светлой темы (фон заставки при запуске и цвет строки состояния).
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
    background_color: "#f4efe4",
    theme_color: "#f4efe4",
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
