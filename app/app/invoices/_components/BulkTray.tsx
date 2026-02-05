"use client";

import React, { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSelection } from "./selection";

/**
 * BulkTray for INVOICES page ONLY.
 * - Export ALL uses current filters (drops pagination params).
 * - Export SELECTED passes ?ids=1,2,3 to /api/invoices/export.
 * - Delete works similarly against /api/invoices/bulk-delete (toggle ALLOW_DELETE below).
 *
 * Keep parity with the Products BulkTray (export, delete, clear, "select all").
 */

const ALLOW_DELETE = true; // flip to false if you want to hide "Delete" for invoices

export default function BulkTray({ total }: { total: number }) {
  const { selectedIds, clear, allFiltered, setAllFiltered } = useSelection();
  const router = useRouter();
  const sp = useSearchParams();

  const [isDeleting, setIsDeleting] = useState(false);

  // Filters you want to carry forward when exporting ALL filtered
  const filterKeysToKeep = new Set([
    "q",
    "from",
    "to",
    "customerId",
    "sort",
    "dir",
    // add more if needed in future
  ]);

  // Build CSV export href for INVOICES
  const csvHref = useMemo(() => {
    if (allFiltered) {
      const params = new URLSearchParams();
      for (const [k, v] of Array.from(sp.entries())) {
        if (filterKeysToKeep.has(k)) params.set(k, v);
      }
      return `/api/invoices/export${params.size ? `?${params.toString()}` : ""}`;
    }
    if (selectedIds.length) {
      return `/api/invoices/export?ids=${selectedIds.join(",")}`;
    }
    return "";
  }, [allFiltered, selectedIds, sp]);

  const selectedCount = allFiltered ? total : selectedIds.length;
  const hasAny = selectedCount > 0;

  const downloadFileName = useMemo(() => {
    // use filter dates when exporting ALL filtered, else mark as selected
    if (allFiltered) {
      const from = sp.get("from") || "all";
      const to = sp.get("to") || "all";
      return `invoices_${from}_${to}.csv`;
    }
    return selectedIds.length ? "invoices_selected.csv" : "invoices_export.csv";
  }, [allFiltered, selectedIds.length, sp]);

  const handleDelete = async () => {
    if (!ALLOW_DELETE || !hasAny || isDeleting) return;

    const msg = allFiltered
      ? `Delete ALL ${total} filtered invoice(s)? This cannot be undone.`
      : `Delete ${selectedIds.length} selected invoice(s)? This cannot be undone.`;

    if (!confirm(msg)) return;

    setIsDeleting(true);
    try {
      // Carry forward ONLY the relevant filters when deleting ALL filtered
      const payload = allFiltered
        ? {
            all: true,
            ...Object.fromEntries(
              Array.from(sp.entries()).filter(([k]) => filterKeysToKeep.has(k))
            ),
          }
        : { ids: selectedIds };

      const res = await fetch("/api/invoices/bulk-delete", {
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
      alert("Failed to delete invoices.");
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
              download={downloadFileName}
              aria-disabled={!csvHref}
              onClick={(e) => {
                if (!csvHref) e.preventDefault();
              }}
              title={allFiltered ? "Export ALL filtered invoices" : "Export selected invoices"}
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
                title={allFiltered ? "Delete ALL filtered invoices" : "Delete selected invoices"}
              >
                {isDeleting
                  ? "Deleting…"
                  : allFiltered
                  ? "Delete ALL"
                  : "Delete selected"}
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
