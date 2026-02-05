"use client";

import React, { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSelection } from "./selection";

const ALLOW_DELETE = true;

export default function BulkTray({ total }: { total: number }) {
  const { selectedIds, clear, allFiltered, setAllFiltered } = useSelection();
  const router = useRouter();
  const sp = useSearchParams();
  const [isDeleting, setIsDeleting] = useState(false);

  const filterKeysToKeep = new Set(["q", "page", "perPage"]);

  const csvHref = useMemo(() => {
    if (allFiltered) {
      const params = new URLSearchParams();
      for (const [k, v] of Array.from(sp.entries())) {
        if (filterKeysToKeep.has(k)) params.set(k, v);
      }
      params.delete("page");
      return `/api/quotations/export${params.size ? `?${params.toString()}` : ""}`;
    }
    if (selectedIds.length) {
      return `/api/quotations/export?ids=${selectedIds.join(",")}`;
    }
    return "";
  }, [allFiltered, selectedIds, sp]);

  const selectedCount = allFiltered ? total : selectedIds.length;
  const hasAny = selectedCount > 0;

  const handleDelete = async () => {
    if (!ALLOW_DELETE || !hasAny || isDeleting) return;
    const msg = allFiltered
      ? `Delete ALL ${total} filtered quotation(s)? This cannot be undone.`
      : `Delete ${selectedIds.length} selected quotation(s)? This cannot be undone.`;
    if (!confirm(msg)) return;

    setIsDeleting(true);
    try {
      const payload = allFiltered
        ? {
            all: true,
            ...Object.fromEntries(
              Array.from(sp.entries()).filter(([k]) => filterKeysToKeep.has(k))
            ),
          }
        : { ids: selectedIds };

      const res = await fetch("/api/quotations/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || "Delete failed");
      }
      clear();
      setAllFiltered(false);
      router.refresh();
    } catch (err) {
      console.error(err);
      alert("Failed to delete quotations.");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleClear = () => {
    clear();
    setAllFiltered(false);
  };

  if (!hasAny) {
    return total > 0 ? (
      <div className="text-sm text-gray-600 mt-1">
        <button
          type="button"
          className="underline"
          onClick={() => setAllFiltered(true)}
          aria-label={`Select all ${total} filtered results`}
          title={`Select all ${total} filtered results`}
        >
          Select all {total} results
        </button>
      </div>
    ) : null;
  }

  return (
    <div className="sticky bottom-4 left-0 right-0 mx-auto max-w-5xl z-20">
      <div className="rounded-2xl border p-3 bg-white/80 dark:bg-slate-900/80 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm">
            {allFiltered
              ? `All ${total} filtered results selected`
              : `${selectedIds.length} selected`}
          </div>

          <div className="flex items-center gap-2">
            <a
              className="px-3 py-2 rounded-xl border disabled:opacity-60"
              href={csvHref || undefined}
              aria-disabled={!csvHref}
              onClick={(e) => {
                if (!csvHref) e.preventDefault();
              }}
              title={allFiltered ? "Export ALL filtered quotations" : "Export selected quotations"}
            >
              {allFiltered ? "Export ALL (CSV)" : "Export selected (CSV)"}
            </a>

            {ALLOW_DELETE && (
              <button
                type="button"
                className="px-3 py-2 rounded-xl border bg-red-600 text-white disabled:opacity-60"
                onClick={handleDelete}
                disabled={isDeleting}
                aria-busy={isDeleting}
                title={allFiltered ? "Delete ALL filtered quotations" : "Delete selected quotations"}
              >
                {isDeleting ? "Deleting…" : allFiltered ? "Delete ALL" : "Delete selected"}
              </button>
            )}

            <button
              type="button"
              className="px-3 py-2 rounded-xl border"
              onClick={handleClear}
              disabled={isDeleting}
              title="Clear selection"
            >
              Clear
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
