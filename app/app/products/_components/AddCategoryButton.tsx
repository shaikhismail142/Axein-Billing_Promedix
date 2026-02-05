"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AddCategoryButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onAdd() {
    const name = prompt("Enter new category name");
    if (!name || !name.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || "Failed to add category");
      }
      router.refresh();
    } catch (e: any) {
      alert(e?.message || "Failed to add category");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="btn btn-outline" onClick={onAdd} disabled={busy}>
      {busy ? "Adding..." : "Add Category"}
    </button>
  );
}
