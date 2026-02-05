'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useCallback,
} from 'react';

type Theme = 'light' | 'dark';
type Mode  = 'system' | Theme;

type Ctx = {
  /** Back-compat alias for resolved theme */
  theme: Theme;
  /** What is actually applied to the UI */
  resolvedTheme: Theme;
  /** User preference: 'system' | 'light' | 'dark' */
  mode: Mode;
  /** Set mode; accepts 'system' | 'light' | 'dark' */
  setTheme: (m: Mode) => void;
  /** Convenience: toggles between light/dark (sets explicit mode, not system) */
  toggle: () => void;
};

const ThemeCtx = createContext<Ctx | null>(null);

// Storage keys (new + legacy)
const LS_MODE_KEY = 'axein_theme_mode';   // 'system' | 'light' | 'dark'
const LS_OLD_KEY  = 'axein_theme';        // legacy: 'light' | 'dark'

function getSystemTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readPreferredMode(): Mode {
  try {
    const m = localStorage.getItem(LS_MODE_KEY) as Mode | null;
    if (m === 'system' || m === 'light' || m === 'dark') return m;
    const legacy = localStorage.getItem(LS_OLD_KEY) as Theme | null;
    if (legacy === 'light' || legacy === 'dark') return legacy;
  } catch { /* ignore */ }
  return 'system';
}

function ensureColorSchemeMeta() {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'color-scheme');
    document.head.appendChild(meta);
  }
  return meta;
}

function applyResolvedTheme(t: Theme) {
  const html = document.documentElement;
  html.classList.toggle('dark', t === 'dark');
  html.setAttribute('data-theme', t);
  const meta = ensureColorSchemeMeta();
  meta.setAttribute('content', 'light dark');
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>('system');
  const [resolvedTheme, setResolvedTheme] = useState<Theme>('light');

  // Pre-paint: avoid FOUC
  useLayoutEffect(() => {
    const initialMode = readPreferredMode();
    const resolved = initialMode === 'system' ? getSystemTheme() : initialMode;
    applyResolvedTheme(resolved);
    setMode(initialMode);
    setResolvedTheme(resolved);
  }, []);

  // Track OS changes only in system mode
  useEffect(() => {
    if (mode !== 'system') return;
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = () => {
      const next = mq.matches ? 'dark' : 'light';
      applyResolvedTheme(next);
      setResolvedTheme(next);
    };
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [mode]);

  const setTheme = useCallback((m: Mode) => {
    try {
      localStorage.setItem(LS_MODE_KEY, m);
      localStorage.removeItem(LS_OLD_KEY);
    } catch { /* ignore */ }

    if (m === 'system') {
      const sys = getSystemTheme();
      applyResolvedTheme(sys);
      setMode('system');
      setResolvedTheme(sys);
    } else {
      applyResolvedTheme(m);
      setMode(m);
      setResolvedTheme(m);
    }
  }, []);

  const toggle = useCallback(() => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  }, [resolvedTheme, setTheme]);

  const value = useMemo<Ctx>(
    () => ({
      theme: resolvedTheme,       // back-compat
      resolvedTheme,
      mode,
      setTheme,
      toggle,
    }),
    [resolvedTheme, mode, setTheme, toggle]
  );

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
