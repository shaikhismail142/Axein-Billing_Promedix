export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { pool } from "@/lib/db";
import { getTaxReport } from "@/app/lib/tax-report";

function inr(n: number) {
  const v = Number(n || 0);
  return `INR (Rs/-) ${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function TaxPrintPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; group?: string; includeDraft?: string };
}) {
  const group = searchParams?.group === "quarter" ? "quarter" : "month";
  const includeDraft = searchParams?.includeDraft === "1";
  const { from, to, summary, months } = await getTaxReport(searchParams?.from, searchParams?.to, {
    group,
    includeDraft,
  });

  const bizRs = await pool.query(`SELECT value_json FROM settings WHERE key='business' LIMIT 1`);
  const biz = bizRs.rows?.[0]?.value_json || {};

  const statusLabel = summary.status === "Payable" ? "GST Payable" : "ITC Credit";
  const statusColor = summary.status === "Payable" ? "#b45309" : "#065f46";

  return (
    <div className="print-area tax-print">
      <style>{`
          @page { size: A4; margin: 12mm; }
          @media print {
            .noprint { display: none !important; }
            #site-chrome, header, footer, .topbar, .sidebar { display: none !important; }
            body { background: #fff !important; }
          }
          .tax-print { font-family: "Manrope", ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; color: #0b1220; background: #fff; padding: 24px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .tax-print h1,.tax-print h2,.tax-print h3 { margin: 0; }
          .tax-print .muted { color: #475569; }
          .tax-print .header { border-radius: 14px; overflow: hidden; border: 1px solid #e2e8f0; background: #f8fafc; }
          .tax-print .header-top { background: #e8f1ff; color: #0b1220; padding: 16px 18px; display:flex; justify-content:space-between; gap:12px; }
          .tax-print .title { font-size: 22px; font-weight: 700; letter-spacing: 0.08em; color: #0b1220; }
          .tax-print .summary { display:grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 10px; margin-top: 12px; }
          .tax-print .card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 10px; background: #f8fafc; color: #0b1220; box-shadow: none; }
          .tax-print .metric { background: #f8fafc; }
          .tax-print .metric .value { font-size: 18px; font-weight: 700; color: #0b1220; }
          .tax-print .metric-payable .value { color: #b45309; }
          .tax-print table { width: 100%; border-collapse: collapse; margin-top: 12px; color: #0b1220; }
          .tax-print th, .tax-print td { border-top: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; }
          .tax-print th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; color: #334155; }
          .tax-print .right { text-align: right; }
        `}</style>
        <div className="noprint" style={{ marginBottom: 12 }}>
          <button id="printBtn" style={{ border: "1px solid #e5e7eb", padding: "6px 10px", borderRadius: 6 }}>Print</button>
          <script
            dangerouslySetInnerHTML={{
              __html: `
                addEventListener('load', () => {
                  const b = document.getElementById('printBtn');
                  if (b) b.addEventListener('click', () => window.print());
                });
              `,
            }}
          />
        </div>

        <div className="header">
          <div className="header-top">
            <div>
              <div className="title">GST SUMMARY</div>
              <div style={{ marginTop: 6, fontWeight: 600 }}>{biz.name || "Your Business"}</div>
              {biz.address && <div style={{ opacity: 0.85 }}>{biz.address}</div>}
              {biz.gstin && <div>GSTIN: {biz.gstin}</div>}
            </div>
            <div style={{ textAlign: "right", fontSize: 12 }}>
              <div><b>Period:</b> {from} to {to}</div>
              <div><b>Grouping:</b> {group === "quarter" ? "Quarterly" : "Monthly"}</div>
              <div><b>Draft Purchases:</b> {includeDraft ? "Included" : "Excluded"}</div>
              <div><b>Generated:</b> {new Date().toLocaleString("en-IN")}</div>
            </div>
          </div>
        </div>

        <div className="summary">
          <div className="card metric">
            <div className="muted">Output GST (Sales)</div>
            <div className="value">{inr(summary.output_tax)}</div>
          </div>
          <div className="card metric">
            <div className="muted">Input GST (Purchases / ITC)</div>
            <div className="value">{inr(summary.input_tax)}</div>
          </div>
          <div className="card metric metric-payable">
            <div className="muted">{statusLabel}</div>
            <div className="value" style={{ color: statusColor }}>{inr(Math.abs(summary.net_tax))}</div>
          </div>
        </div>

        <div className="muted" style={{ marginTop: 8 }}>
          Output GST = tax collected on invoices. Input GST = tax paid on purchases (eligible ITC). Net = Output − Input.
          Draft purchases are {includeDraft ? "included" : "excluded"}.
        </div>

        <table>
          <thead>
            <tr>
              <th>Period</th>
              <th className="right">Output GST</th>
              <th className="right">Input GST</th>
              <th className="right">Net</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.period}>
                <td>{m.label}</td>
                <td className="right">{inr(m.output_tax)}</td>
                <td className="right">{inr(m.input_tax)}</td>
                <td className="right">{inr(m.net_tax)}</td>
              </tr>
            ))}
            {months.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">No tax data for the selected period.</td>
              </tr>
            )}
          </tbody>
        </table>
    </div>
  );
}
