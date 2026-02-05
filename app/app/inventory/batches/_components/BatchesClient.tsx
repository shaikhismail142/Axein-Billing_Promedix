// app/inventory/batches/_components/BatchesClient.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { ApiResp, Batch } from "../page";

type Props = {
  initialData: ApiResp;
  current: {
    page: string;
    q: string;
    expiry: "all" | "near" | "expired";
    onlyQty: "true" | "false";
  };
};

type DirtyMap = Record<string, Partial<Pick<Batch, "mfg_date" | "exp_date">>>;

export default function BatchesClient({ initialData, current }: Props) {
  const router = useRouter();

  const [rows, setRows] = React.useState<Batch[]>(initialData.items);
  const [dirty, setDirty] = React.useState<DirtyMap>({});
  const [selected, setSelected] = React.useState<Record<string, boolean>>({});
  const [selectAll, setSelectAll] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  // Keep in sync if server reloads
  React.useEffect(() => {
    setRows(initialData.items);
    setDirty({});
    setSelected({});
    setSelectAll(false);
  }, [initialData.items]);

  const markDirty = (id: string, patch: Partial<Pick<Batch, "mfg_date" | "exp_date">>) => {
    setDirty((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  };

  const onDateChange = (id: string, field: "mfg_date" | "exp_date", value: string) => {
    setRows((rs) =>
      rs.map((r) => (r.id === id ? { ...r, [field]: value || null } : r))
    );
    markDirty(id, { [field]: value || null });
  };

  const toggleRow = (id: string, checked: boolean) => {
    setSelected((s) => ({ ...s, [id]: checked }));
  };

  const toggleSelectAll = (checked: boolean) => {
    setSelectAll(checked);
    if (checked) {
      const all: Record<string, boolean> = {};
      for (const r of rows) all[r.id] = true;
      setSelected(all);
    } else {
      setSelected({});
    }
  };

  const rowIsDirty = (id: string) => !!dirty[id] && (dirty[id].mfg_date !== undefined || dirty[id].exp_date !== undefined);

  async function saveOne(id: string) {
    const payload = dirty[id];
    if (!payload) return;

    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/batches/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mfg_date: payload.mfg_date ?? undefined,
          exp_date: payload.exp_date ?? undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json?.error || `Save failed (${res.status})`);

      const updated: Batch | null = json.item;
      if (updated) {
        setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...updated } : r)));
      }
      setDirty((d) => {
        const { [id]: _, ...rest } = d;
        return rest;
      });
      setMsg("Saved.");
    } catch (e: any) {
      setMsg(e.message || "Error while saving");
    } finally {
      setBusy(false);
    }
  }

  async function saveAllModified() {
    const ids = Object.keys(dirty);
    if (ids.length === 0) return setMsg("Nothing to save.");
    setBusy(true);
    setMsg(null);
    try {
      for (const id of ids) {
        await saveOne(id);
      }
      setMsg("All modified rows saved.");
    } finally {
      setBusy(false);
    }
  }

  // Bulk section
  const [bulkField, setBulkField] = React.useState<"mfg_date" | "exp_date">("exp_date");
  const [bulkDate, setBulkDate] = React.useState<string>("");

  function applyBulkToSelected() {
    const ids = Object.keys(selected).filter((k) => selected[k]);
    if (ids.length === 0) return setMsg("Select at least one row.");
    if (!bulkDate) return setMsg("Pick a date to apply.");
    setRows((rs) =>
      rs.map((r) =>
        selected[r.id] ? { ...r, [bulkField]: bulkDate } : r
      )
    );
    setDirty((d) => {
      const out = { ...d };
      for (const id of ids) {
        out[id] = { ...(out[id] || {}), [bulkField]: bulkDate };
      }
      return out;
    });
    setMsg(`${bulkField === "exp_date" ? "Expiry" : "MFG"} date applied to selected.`);
  }

  async function saveSelected() {
    const ids = Object.keys(selected).filter((k) => selected[k] && dirty[k]);
    if (ids.length === 0) return setMsg("No selected rows require saving.");
    setBusy(true);
    setMsg(null);
    try {
      for (const id of ids) {
        await saveOne(id);
      }
      setMsg("Selected rows saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Batches</h1>
        <div className="flex items-center gap-2">
          <button
            className="px-3 py-2 rounded-2xl shadow-sm border"
            disabled={busy}
            onClick={saveAllModified}
            title="Save all rows that have unsaved changes"
          >
            Save All Modified
          </button>
        </div>
      </div>

      {msg && (
        <div className="text-sm p-2 rounded border bg-neutral-50 dark:bg-neutral-900">
          {busy ? "Working… " : ""}{msg}
        </div>
      )}

      <div className="overflow-auto rounded-2xl border">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-100 dark:bg-neutral-900">
            <tr>
              <th className="p-2">
                <input
                  type="checkbox"
                  checked={selectAll}
                  onChange={(e) => toggleSelectAll(e.target.checked)}
                />
              </th>
              <th className="p-2 text-left">Product</th>
              <th className="p-2 text-left">SKU</th>
              <th className="p-2 text-left">Batch</th>
              <th className="p-2 text-left">MFG</th>
              <th className="p-2 text-left">Expiry</th>
              <th className="p-2 text-right">Qty</th>
              <th className="p-2 text-right">Days Left</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="p-4 text-center text-neutral-500">
                  No batches found.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const dirtyRow = dirty[r.id] || {};
              const mfgDirty = dirtyRow.mfg_date !== undefined;
              const expDirty = dirtyRow.exp_date !== undefined;

              return (
                <tr key={r.id} className="border-t">
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={!!selected[r.id]}
                      onChange={(e) => toggleRow(r.id, e.target.checked)}
                    />
                  </td>
                  <td className="p-2">{r.product_name ?? "—"}</td>
                  <td className="p-2">{r.sku ?? "—"}</td>
                  <td className="p-2">{r.batch_no ?? "—"}</td>
                  <td className="p-2">
                    <input
                      type="date"
                      value={r.mfg_date ?? ""}
                      onChange={(e) => onDateChange(r.id, "mfg_date", e.target.value)}
                      className={`px-2 py-1 rounded border bg-transparent w-[12ch] ${mfgDirty ? "ring-2 ring-amber-400" : ""}`}
                    />
                  </td>
                  <td className="p-2">
                    <input
                      type="date"
                      value={r.exp_date ?? ""}
                      onChange={(e) => onDateChange(r.id, "exp_date", e.target.value)}
                      className={`px-2 py-1 rounded border bg-transparent w-[12ch] ${expDirty ? "ring-2 ring-amber-400" : ""}`}
                    />
                  </td>
                  <td className="p-2 text-right">{r.qty}</td>
                  <td className="p-2 text-right">{r.days_left ?? "—"}</td>
                  <td className="p-2 text-right">
                    {rowIsDirty(r.id) ? (
                      <button
                        className="px-3 py-1 rounded-2xl border shadow-sm"
                        disabled={busy}
                        onClick={() => saveOne(r.id)}
                      >
                        Save
                      </button>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Bulk actions */}
      <div className="mt-3 rounded-2xl border p-3 flex flex-wrap items-end gap-3">
        <div className="flex flex-col">
          <label className="text-xs mb-1">Field</label>
          <select
            className="px-3 py-2 rounded-2xl border shadow-sm"
            value={bulkField}
            onChange={(e) => setBulkField(e.target.value as "mfg_date" | "exp_date")}
          >
            <option value="mfg_date">MFG date</option>
            <option value="exp_date">Expiry date</option>
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs mb-1">Date</label>
          <input
            type="date"
            className="px-3 py-2 rounded-2xl border shadow-sm"
            value={bulkDate}
            onChange={(e) => setBulkDate(e.target.value)}
          />
        </div>
        <button
          className="px-4 py-2 rounded-2xl border shadow-sm"
          onClick={applyBulkToSelected}
          disabled={busy}
        >
          Apply to Selected (no save)
        </button>
        <button
          className="px-4 py-2 rounded-2xl border shadow-sm"
          onClick={saveSelected}
          disabled={busy}
        >
          Save Selected
        </button>
      </div>

      <div className="text-xs text-neutral-500">
        Tip: “Apply to Selected” updates the table values and marks them dirty. Use “Save Selected” (or the row Save button) to persist.
      </div>
    </div>
  );
}
