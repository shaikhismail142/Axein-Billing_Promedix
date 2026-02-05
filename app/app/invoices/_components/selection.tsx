"use client";
import { createContext, useContext, useMemo, useState } from "react";

type SelCtx = {
  selectedIds: number[];
  toggleId: (id: number) => void;
  clear: () => void;
  selectPage: (ids: number[]) => void;
  unselectPage: (ids: number[]) => void;

  allFiltered: boolean;              // “Select all results” across pages
  setAllFiltered: (v: boolean) => void;
};

const Ctx = createContext<SelCtx | null>(null);

export function SelectionProvider({ children }: { children: React.ReactNode }) {
  const [selectedIds, setSelected] = useState<number[]>([]);
  const [allFiltered, setAllFiltered] = useState<boolean>(false);

  const value = useMemo<SelCtx>(
    () => ({
      selectedIds,
      toggleId: (id: number) =>
        setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])),
      clear: () => {
        setSelected([]);
        setAllFiltered(false);
      },
      selectPage: (ids: number[]) =>
        setSelected((s) => Array.from(new Set([...s, ...ids]))),
      unselectPage: (ids: number[]) =>
        setSelected((s) => s.filter((x) => !ids.includes(x))),
      allFiltered,
      setAllFiltered,
    }),
    [selectedIds, allFiltered]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSelection() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSelection must be used within SelectionProvider");
  return ctx;
}
