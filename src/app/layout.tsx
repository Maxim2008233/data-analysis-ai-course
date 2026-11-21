import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Literata } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { Sidebar, type SidebarModule } from "@/components/Sidebar";
import { AuthNotice } from "@/components/AuthNotice";
import { SiteFooter } from "@/components/SiteFooter";
import { themeInitScript } from "@/components/ThemeToggle";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/config";
import { buildCourseIndex, loadCourse } from "@/lib/content/load";

const textFont = IBM_Plex_Sans({ variable: "--font-text", subsets: ["latin", "cyrillic"], weight: ["400", "500", "600", "700"], display: "swap" });
const displayFont = Literata({ variable: "--font-display", subsets: ["latin", "cyrillic"], display: "swap" });
const codeFont = IBM_Plex_Mono({ variable: "--font-code", subsets: ["latin", "cyrillic"], weight: ["400", "500", "600"], display: "swap" });

export const metadata: Metadata = {
  title: { default: SITE_NAME, template: `%s — ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4efe4" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1726" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const index = buildCourseIndex(loadCourse());
  const modules: SidebarModule[] = index.modules.map((m) => ({
    id: m.id,
    slug: m.slug,
    number: m.number,
    label: m.label,
    short: m.short,
    kind: m.kind,
    lessons: m.lessons,
  }));
  return (
    <html lang="ru" className={`${textFont.variable} ${displayFont.variable} ${codeFont.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="antialiased">
        <AuthProvider>
          <div className="min-h-screen lg:grid lg:grid-cols-[17.5rem_minmax(0,1fr)]">
            <Sidebar modules={modules} />
            <div className="flex min-h-screen min-w-0 flex-col">
              <AuthNotice />
              <main className="flex-1">{children}</main>
              <SiteFooter />
            </div>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
