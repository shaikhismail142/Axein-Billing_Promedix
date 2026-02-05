// app/components/ThemeToggle.tsx
'use client';

import { useTheme } from '@/app/providers/ThemeProvider';

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';
  const label = isDark ? 'Dark' : 'Light';
  const icon = isDark ? '🌙' : '☀️';
  return (
    <button
      className="glass-btn"
      onClick={toggle}
      aria-label="Toggle theme"
      aria-pressed={isDark}
      title={`Switch to ${isDark ? 'light' : 'dark'} theme`}
      style={{ color: 'var(--text)' }}
    >
      <span style={{ marginRight: 6 }}>{icon}</span>
      {label}
    </button>
  );
}
