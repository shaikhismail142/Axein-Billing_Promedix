'use client';

export default function Topbar({ onMenu }: { onMenu: () => void }) {
  return (
    <header
      className="sticky top-0 z-30"
      style={{
        background: 'var(--glass-bg)',
        backdropFilter: 'blur(8px) saturate(140%)',
        borderBottom: '1px solid var(--glass-brd)',
      }}
    >
      <div className="h-14 px-4 flex items-center justify-between">
        {/* Hamburger on mobile */}
        <button
          onClick={onMenu}
          className="sm:hidden inline-flex items-center justify-center rounded-lg px-3 py-2"
          style={{ border: '1px solid var(--glass-brd)', background: 'var(--glass-bg)', color: 'var(--text)' }}
          aria-label="Open menu"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        <div style={{ color: 'var(--text)' }} className="font-medium">AxEin Billing</div>
        <div style={{ color: 'var(--muted)' }} className="text-xs">IST</div>
      </div>
    </header>
  );
}
