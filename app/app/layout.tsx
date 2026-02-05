import "./globals.css";
import { ThemeProvider } from "./providers/ThemeProvider";
import AppHeader from "@/components/AppHeader";
import SiteFooter from "@/components/SiteFooter";
import ClientShell from "@/components/ClientShell";
import LicenseBanner from "./_components/LicenseBanner";
import AlertsBell from "@/app/_components/AlertsBell";
import ThemeToggle from "@/app/_components/ThemeToggle";
import Link from "next/link";
import type { CSSProperties } from "react";

export const metadata = {
  title: "Billing",
  description: "AxEin Billing — Next.js 14 + Postgres",
};

export const viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased bg-[var(--bg)] text-[var(--text)]">
        {/* Skip link for a11y */}
        <Link
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] bg-black/80 text-white px-3 py-2 rounded-xl"
        >
          Skip to content
        </Link>

        <ThemeProvider>
          <div className="app-shell min-h-dvh flex flex-col">
            {/* Header (now provides Dashboard / Inventory / Invoices / Reports / Settings) */}
            <div id="site-chrome">
              <AppHeader />
            </div>

            {/* Top-right tray: Theme + Alerts (fixed, no overlap) */}
            <div
              className="fixed z-[70] top-3 right-3 sm:top-4 sm:right-4 pointer-events-none"
              style={
                {
                  insetInlineEnd: "max(env(safe-area-inset-right, 0px), 0.75rem)",
                  insetBlockStart: "max(env(safe-area-inset-top, 0px), 0.75rem)",
                } as CSSProperties
              }
              aria-label="Quick actions"
              role="region"
            >
              <div className="flex items-center gap-3">
                <div className="pointer-events-auto">
                  <ThemeToggle />
                </div>
                <div className="pointer-events-auto">
                  <AlertsBell />
                </div>
              </div>
            </div>

            {/* License status banner (auto-hides when licensed) */}
            <LicenseBanner />

            {/* Main */}
            <ClientShell>
              <main id="main" className="app-main">
                {children}
              </main>
            </ClientShell>

            {/* Footer */}
            <SiteFooter />
          </div>
        </ThemeProvider>

        {/* Portal root for popovers/menus/modals to avoid z-index fights */}
        <div id="portal-root" className="relative z-[80]" />
      </body>
    </html>
  );
}
