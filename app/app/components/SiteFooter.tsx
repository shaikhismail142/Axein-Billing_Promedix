export default function SiteFooter() {
  return (
    <footer
      style={{
        marginTop: 24,
        padding: "16px 0",
        textAlign: "center",
        borderTop: "1px solid var(--glass-brd)",
        color: 'var(--text)'
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/axein.jpg"
        alt="AxEin"
        style={{ height: 44, display: "block", margin: "0 auto 8px", borderRadius: 8 }}
      />
      <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>
        Smart Billing. Smarter Business.
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>
        © {new Date().getFullYear()} AxEin Technologies. All rights reserved.
      </div>
    </footer>
  );
}
