"use client";
import { useRouter } from "next/navigation";
import { useSelection } from "./selection";

export default function BulkTray({ total, q }: { total: number; q: string }) {
  const { selectedIds, clear, allFiltered, setAllFiltered } = useSelection();
  const router = useRouter();

  const hasAny = allFiltered || selectedIds.length > 0;

  // When nothing is selected, show the "Select all" hint
  if (!hasAny) {
    return total > 0 ? (
      <div className="text-sm text-gray-600 mt-1">
        <button className="underline" onClick={() => setAllFiltered(true)}>
          Select all {total} results
        </button>
      </div>
    ) : null;
  }

  const exportHref = allFiltered
    ? `/api/products/export${q ? `?q=${encodeURIComponent(q)}` : ""}`
    : `/api/products/export?ids=${selectedIds.join(",")}`;

  const handleDelete = async () => {
    const prompt = allFiltered
      ? `Delete ALL ${total} filtered products?`
      : `Delete ${selectedIds.length} selected product(s)?`;
    if (!confirm(prompt)) return;

    const res = await fetch("/api/products/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(allFiltered ? { all: true, q } : { ids: selectedIds }),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      alert(msg || "Delete failed");
      return;
    }
    clear();
    router.refresh();
  };

  return (
    <div className="sticky bottom-4 left-0 right-0 mx-auto max-w-6xl">
      <div className="rounded-2xl border p-3 bg-white/80 dark:bg-slate-900/80 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm">
            {allFiltered
              ? `All ${total} filtered results selected`
              : `${selectedIds.length} selected`}
          </div>
          <div className="flex items-center gap-2">
            <a className="px-3 py-2 rounded-xl border" href={exportHref}>
              {allFiltered ? "Export ALL" : "Export selected"}
            </a>
            <button className="px-3 py-2 rounded-xl border bg-red-600 text-white" onClick={handleDelete}>
              {allFiltered ? "Delete ALL" : "Delete selected"}
            </button>
            <button className="px-3 py-2 rounded-xl border" onClick={() => clear()}>
              Clear
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
