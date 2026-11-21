import { NextResponse } from "next/server";
import { buildReferenceData } from "@/lib/content/reference";

// Генерируется один раз при сборке (статический JSON для панели «Справочник» в уроках).
export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(buildReferenceData());
}
