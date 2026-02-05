"use client";

import { useEffect, useState } from "react";
import { useTheme } from "@/app/providers/ThemeProvider"; // <-- use YOUR provider

export default function ThemeToggle() {
  const { resolvedTheme, toggle, setTheme, mode } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Toggle theme"
        onClick={toggle}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl
                   shadow-sm ring-1 ring-black/10
                   bg-[var(--surface-1)] text-[var(--text)]
                   hover:opacity-90 dark:bg-slate-900/70"
        title={mounted ? (isDark ? "Switch to light" : "Switch to dark") : "Toggle theme"}
      >
        {mounted ? (isDark ? "🌙" : "☀️") : <span className="sr-only">Toggle theme</span>}
      </button>

      {/* Optional tiny menu: click+hold to pick explicit mode */}
      <div className="sr-only">Current mode: {mode}</div>
      {/* If you want a 3-way menu later: Light / Dark / System, call setTheme('light'|'dark'|'system') */}
    </div>
  );
}
