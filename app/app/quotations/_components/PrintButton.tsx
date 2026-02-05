// app/quotations/_components/PrintButton.tsx
'use client';

import { useState } from 'react';

export default function PrintButton({ href }: { href: string }) {
  const [busy, setBusy] = useState(false);

  const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (!href || busy) return;

    try {
      setBusy(true);

      // Open the PDF in a new tab
      const win = window.open(href, '_blank', 'noopener,noreferrer');

      // If the popup was blocked or couldn’t open, fallback: just navigate
      if (!win) {
        window.location.href = href;
        return;
      }

      // Try to call print after the PDF tab is focused (best-effort)
      // Some browsers block cross-window print; this is safe to attempt.
      setTimeout(() => {
        try {
          win.focus();
          // @ts-ignore - not typed cross-origin; works for PDF viewer tabs in many browsers
          if (typeof win.print === 'function') win.print();
        } catch {
          /* ignore if browser blocks cross-window print */
        }
      }, 400);
    } finally {
      // brief delay to keep the spinner visible
      setTimeout(() => setBusy(false), 350);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      className="px-3 py-2 rounded-2xl glass-btn text-sm"
      aria-label="Open PDF and print"
      title="Open PDF and print"
    >
      {busy ? 'Preparing…' : 'Print'}
    </button>
  );
}
