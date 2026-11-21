import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Literata } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { Sidebar, type SidebarModule } from "@/components/Sidebar";
import { AuthNotice } from "@/components/AuthNotice";
import { PwaBanner } from "@/components/pwa/PwaBanner";
import { PwaRegister } from "@/components/pwa/PwaRegister";
import { installCaptureScript } from "@/lib/pwa/install-script";
import { SiteFooter } from "@/components/SiteFooter";
import { ThemeColorSync, themeInitScript } from "@/components/ThemeToggle";
import { APP_SHORT_NAME, SITE_DESCRIPTION, SITE_NAME, THEME_COLOR_DARK, THEME_COLOR_LIGHT } from "@/lib/config";
import { buildCourseIndex, loadCourse } from "@/lib/content/load";

const textFont = IBM_Plex_Sans({ variable: "--font-text", subsets: ["latin", "cyrillic"], weight: ["400", "500", "600", "700"], display: "swap" });
const displayFont = Literata({ variable: "--font-display", subsets: ["latin", "cyrillic"], display: "swap" });
const codeFont = IBM_Plex_Mono({ variable: "--font-code", subsets: ["latin", "cyrillic"], weight: ["400", "500", "600"], display: "swap" });

// Иконки берутся из файлов src/app/favicon.ico, icon.svg, apple-icon.png, манифест — из src/app/manifest.ts.
export const metadata: Metadata = {
  title: { default: SITE_NAME, template: `%s — ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  // iPhone и iPad: «На экран „Домой“» открывает сайт как отдельное приложение, без панелей Safari
  appleWebApp: { capable: true, title: APP_SHORT_NAME, statusBarStyle: "default" },
  // не превращать числа из уроков (цены, размеры выборок) в ссылки для звонка
  formatDetection: { telephone: false },
  // Next.js выводит только новый mobile-web-app-capable; iOS до 16.4 понимает лишь старое название
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // по системной теме — до загрузки скриптов; дальше ThemeColorSync подстраивает цвет под тему, выбранную на сайте
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLOR_LIGHT },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLOR_DARK },
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
        <script dangerouslySetInnerHTML={{ __html: installCaptureScript }} />
      </head>
      <body className="antialiased">
        <AuthProvider>
          <PwaRegister />
          <ThemeColorSync />
          <div className="min-h-screen lg:grid lg:grid-cols-[17.5rem_minmax(0,1fr)]">
            <Sidebar modules={modules} />
            <div className="flex min-h-screen min-w-0 flex-col">
              <AuthNotice />
              <PwaBanner />
              <main className="flex-1">{children}</main>
              <SiteFooter />
            </div>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
