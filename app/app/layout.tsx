import "./globals.css";
import { ThemeProvider } from "./providers/ThemeProvider";
import ChromeShell from "@/components/ChromeShell";
import Link from "next/link";

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
          <ChromeShell>{children}</ChromeShell>
        </ThemeProvider>

        {/* Portal root for popovers/menus/modals to avoid z-index fights */}
        <div id="portal-root" className="relative z-[80]" />
      </body>
    </html>
  );
}
