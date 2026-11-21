import type { NextConfig } from "next";
import pkg from "./package.json";

// Версия приложения: на Vercel — короткий хеш коммита, локально — версия из package.json.
// Используется, чтобы после деплоя браузер загрузил свежие файлы Python и данных.
const appVersion = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) || `${pkg.version}-${Date.now().toString(36)}`;

const nextConfig: NextConfig = {
  // не сообщать, на каком движке сайт (заголовок X-Powered-By: Next.js)
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        // датасеты и Python-файлы запрашиваются с ?v=<версия>, поэтому их можно кэшировать надолго
        source: "/(data|py|workers)/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // сайт нельзя встроить в чужую страницу (защита от кликджекинга): старый и новый способ
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          // камера, микрофон, геолокация и платежи сайту не нужны
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          // только HTTPS (браузеры учитывают заголовок лишь на HTTPS-адресах, localhost он не затрагивает)
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
