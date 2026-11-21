import type { NextConfig } from "next";
import pkg from "./package.json";

// Версия приложения: на Vercel — короткий хеш коммита, локально — версия из package.json.
// Используется, чтобы после деплоя браузер загрузил свежие файлы Python и данных.
const appVersion = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) || `${pkg.version}-${Date.now().toString(36)}`;

const nextConfig: NextConfig = {
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
        ],
      },
    ];
  },
};

export default nextConfig;
