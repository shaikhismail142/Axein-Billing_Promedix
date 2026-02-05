// Simple line calculator used by billing + reports
export function computeLine(qty: number, unit: number, discPct: number, gstPct: number) {
  const gross = qty * unit;
  const discount = +(gross * (discPct / 100)).toFixed(2);
  const taxable = +(gross - discount).toFixed(2);
  const tax = +((taxable * gstPct) / 100).toFixed(2);
  const total = +(taxable + tax).toFixed(2);
  return { gross, discount, taxable, tax, total };
}

// Financial year string for invoice numbering (e.g., 2025-26)
export function fyString(d = new Date()) {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const start = m >= 4 ? y : y - 1;
  const end = (start + 1).toString().slice(-2);
  return `${start}-${end}`;
}
