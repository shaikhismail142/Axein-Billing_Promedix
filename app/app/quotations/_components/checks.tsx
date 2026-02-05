"use client";

import { useEffect, useRef } from "react";
import { useSelection } from "./selection";

export function MasterCheckbox({ pageIds }: { pageIds: number[] }) {
  const { selectedIds, selectPage, unselectPage, setAllFiltered } = useSelection();
  const pageAllSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
  const someSelected = pageIds.some((id) => selectedIds.includes(id));
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !pageAllSelected && someSelected;
  }, [pageAllSelected, someSelected]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={pageAllSelected}
      onChange={(e) => {
        if (e.target.checked) selectPage(pageIds);
        else unselectPage(pageIds);
        setAllFiltered(false);
      }}
      className="h-4 w-4 accent-blue-600"
      aria-label="Select all on this page"
    />
  );
}

export function RowCheckbox({ id }: { id: number }) {
  const { selectedIds, toggleId, setAllFiltered } = useSelection();
  const checked = selectedIds.includes(id);

  return (
    <input
      type="checkbox"
      className="h-4 w-4 accent-blue-600"
      checked={checked}
      onChange={() => {
        toggleId(id);
        setAllFiltered(false);
      }}
      aria-label={`Select quotation ${id}`}
    />
  );
}
