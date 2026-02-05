"use client";

import { useEffect } from "react";

export default function PrintControls() {
  // Auto-open the print dialog when the page mounts
  useEffect(() => {
    try {
      window.print();
    } catch {}
  }, []);

  return (
    <div className="noprint" style={{ marginBottom: 12 }}>
      <button onClick={() => window.close()} className="border px-3 py-1 rounded">
        Close
      </button>{" "}
      <button onClick={() => window.print()} className="border px-3 py-1 rounded">
        Print
      </button>
    </div>
  );
}
