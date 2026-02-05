"use client";
export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="px-3 py-2 rounded-2xl border border-black/10 bg-[color:var(--surface-1)] hover:bg-[color:var(--surface-2)]"
    >
      Print
    </button>
  );
}
