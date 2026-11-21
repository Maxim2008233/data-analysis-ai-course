import { NextResponse } from "next/server";
import { buildOfflineManifest } from "@/lib/pwa/offline-manifest";

// Список файлов курса для офлайн-режима (страница «Приложение» → «Скачать курс»).
// Генерируется один раз при сборке: статический JSON, как /api/reference.
export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(buildOfflineManifest());
}
