// Uniform INR formatting WITHOUT the ₹ glyph.
// Always renders as: "INR (Rs/-) 12,345.67"

export function formatINRNumber(n: number) {
    return (n ?? 0).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  
  export function formatINR(n: number) {
    const amt = (n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `INR (Rs/-) ${amt}`;
  }
  