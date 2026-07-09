"use client";

import { useState } from "react";

// ─── STANDALONE INVOICE GENERATOR ────────────────────────────────────────────
// Separate from the crew app on purpose: billing is the office's job, not
// dispatch. Manager enters client + line items (crew × hours × bill rate),
// gets a live preview, and prints/saves a clean PDF. Nothing is persisted —
// this is a generator, not a ledger (tracking paid/unpaid can come later).

type Line = {
  id: number;
  description: string;
  qty: string;     // number of crew
  hours: string;   // hours each
  rate: string;    // bill rate $/hr
  otHours: string; // OT hours each (billed at 1.5×)
};

const today = () => new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
const invNumber = () => {
  const d = new Date();
  return `INV-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
};
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (s: string) => { const v = parseFloat(s); return isNaN(v) || v < 0 ? 0 : v; };

const lineTotal = (l: Line) => {
  const q = num(l.qty), h = num(l.hours), r = num(l.rate), ot = num(l.otHours);
  return q * h * r + q * ot * r * 1.5;
};

let nextId = 10;

export default function InvoicePage() {
  // Pre-seeded with the classic ask: "I need 5 guys 11pm–7am."
  const [client, setClient] = useState("New Moon Productions");
  const [clientAddress, setClientAddress] = useState("230 Vesey St\nNew York, NY 10281");
  const [jobRef, setJobRef] = useState("Overnight load-out · 11:00 PM – 7:00 AM");
  const [invoiceNo, setInvoiceNo] = useState(invNumber());
  const [invoiceDate, setInvoiceDate] = useState(today());
  const [terms, setTerms] = useState("Net 30");
  const [taxPct, setTaxPct] = useState("0");
  const [notes, setNotes] = useState("Thank you for your business. Please reference the invoice number with payment.");
  const [lines, setLines] = useState<Line[]>([
    { id: 1, description: "General Labor — overnight crew", qty: "5", hours: "8", rate: "38", otHours: "0" },
  ]);

  const setLine = (id: number, patch: Partial<Line>) =>
    setLines(ls => ls.map(l => (l.id === id ? { ...l, ...patch } : l)));
  const addLine = () =>
    setLines(ls => [...ls, { id: nextId++, description: "", qty: "1", hours: "8", rate: "38", otHours: "0" }]);
  const removeLine = (id: number) => setLines(ls => ls.filter(l => l.id !== id));

  const subtotal = lines.reduce((a, l) => a + lineTotal(l), 0);
  const tax = subtotal * (num(taxPct) / 100);
  const total = subtotal + tax;

  // Print → browser "Save as PDF". Same pattern the tax report uses.
  function printInvoice() {
    const rows = lines.filter(l => lineTotal(l) > 0 || l.description.trim()).map(l => {
      const ot = num(l.otHours) > 0
        ? `<div class="sub">+ ${l.otHours} OT hrs each @ 1.5× (${money(num(l.rate) * 1.5)}/hr)</div>` : "";
      return `<tr>
        <td>${(l.description || "Labor").replace(/[<>]/g, "")}${ot}</td>
        <td class="c">${l.qty}</td>
        <td class="c">${l.hours}</td>
        <td class="r">${money(num(l.rate))}/hr</td>
        <td class="r">${money(lineTotal(l))}</td>
      </tr>`;
    }).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${invoiceNo}</title>
    <style>
      @page { margin: 0.7in; }
      body { font-family: -apple-system,'Helvetica Neue',Arial,sans-serif; color:#111; font-size:11pt; line-height:1.5; }
      .top { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:28pt; }
      .brand { font-size:22pt; font-weight:800; letter-spacing:0.06em; }
      .brand small { display:block; font-size:8pt; font-weight:400; letter-spacing:0.25em; color:#777; margin-top:2pt; }
      .invmeta { text-align:right; font-size:10pt; }
      .invmeta .no { font-size:14pt; font-weight:700; }
      h1 { font-size:15pt; letter-spacing:0.15em; margin:0 0 14pt; }
      .parties { display:flex; gap:40pt; margin-bottom:20pt; }
      .party .label { font-size:8pt; letter-spacing:0.18em; color:#888; text-transform:uppercase; margin-bottom:3pt; }
      .party div { white-space:pre-line; }
      table { width:100%; border-collapse:collapse; font-size:10pt; margin-bottom:14pt; }
      th { text-align:left; background:#111; color:#fff; padding:7pt 9pt; font-size:8.5pt; letter-spacing:0.1em; }
      td { padding:8pt 9pt; border-bottom:1px solid #ddd; vertical-align:top; }
      td.c, th.c { text-align:center; } td.r, th.r { text-align:right; }
      .sub { font-size:8.5pt; color:#666; margin-top:2pt; }
      .totals { margin-left:auto; width:45%; font-size:10.5pt; }
      .totals div { display:flex; justify-content:space-between; padding:4pt 9pt; }
      .totals .grand { border-top:2px solid #111; font-size:13pt; font-weight:800; padding-top:7pt; margin-top:3pt; }
      .notes { margin-top:26pt; font-size:9.5pt; color:#555; border-top:1px solid #ddd; padding-top:10pt; white-space:pre-line; }
      .ref { color:#666; font-size:9.5pt; margin:-14pt 0 18pt; }
    </style></head><body>
      <div class="top">
        <div class="brand">BIG CREW NYC<small>CREW &amp; LABOR SERVICES</small></div>
        <div class="invmeta">
          <div class="no">${invoiceNo}</div>
          <div>Date: ${invoiceDate}</div>
          <div>Terms: ${terms}</div>
        </div>
      </div>
      <h1>INVOICE</h1>
      ${jobRef.trim() ? `<div class="ref">Re: ${jobRef.replace(/[<>]/g, "")}</div>` : ""}
      <div class="parties">
        <div class="party"><div class="label">Bill To</div><div><b>${client.replace(/[<>]/g, "")}</b>\n${clientAddress.replace(/[<>]/g, "")}</div></div>
      </div>
      <table>
        <thead><tr><th>Description</th><th class="c">Crew</th><th class="c">Hrs Each</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="totals">
        <div><span>Subtotal</span><span>${money(subtotal)}</span></div>
        ${num(taxPct) > 0 ? `<div><span>Tax (${taxPct}%)</span><span>${money(tax)}</span></div>` : ""}
        <div class="grand"><span>TOTAL DUE</span><span>${money(total)}</span></div>
      </div>
      ${notes.trim() ? `<div class="notes">${notes.replace(/[<>]/g, "")}</div>` : ""}
      <script>window.onload=()=>window.print()</script>
    </body></html>`;

    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  }

  // Shared input style (kept inline so this page is fully self-contained)
  const inp: React.CSSProperties = {
    width: "100%", padding: "10px 12px", fontSize: 14, borderRadius: 7,
    border: "2px solid #d0d0d0", background: "#fff", color: "#111",
    fontFamily: "'DM Mono','Courier New',monospace", outline: "none", boxSizing: "border-box",
  };
  const lbl: React.CSSProperties = {
    display: "block", fontSize: 10, letterSpacing: "0.18em", color: "#999",
    textTransform: "uppercase", fontWeight: 700, marginBottom: 4,
  };
  const cardS: React.CSSProperties = {
    background: "#fafafa", border: "2px solid #e4e4e4", borderRadius: 10, padding: 14,
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f2f2f2", color: "#111", fontFamily: "'DM Mono','Courier New',monospace", paddingBottom: 60 }}>
      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "2px solid #E8C84A", padding: "14px 16px", position: "sticky", top: 0, zIndex: 50, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontFamily: "'Bebas Neue','Arial Black',sans-serif", fontSize: 22, letterSpacing: "0.1em" }}>INVOICE GENERATOR</div>
          <div style={{ fontSize: 9, color: "#888", letterSpacing: "0.2em" }}>BIG CREW NYC · BILLING</div>
        </div>
        <a href="/manager/dashboard" style={{ fontSize: 11, color: "#666", textDecoration: "none", border: "1px solid #ddd", borderRadius: 7, padding: "7px 12px", background: "#fafafa" }}>← DASHBOARD</a>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "16px 14px", display: "grid", gridTemplateColumns: "1fr", gap: 14 }} className="inv-grid">
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Bebas+Neue&display=swap');
          @media (min-width: 900px) { .inv-grid { grid-template-columns: 1fr 1fr !important; align-items: start; } }
        `}</style>

        {/* ── LEFT: FORM ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={cardS}>
            <span style={lbl}>Bill To</span>
            <input value={client} onChange={e => setClient(e.target.value)} placeholder="Client / company name" style={inp} />
            <textarea value={clientAddress} onChange={e => setClientAddress(e.target.value)} placeholder="Billing address" style={{ ...inp, marginTop: 8, minHeight: 60, resize: "vertical" }} />
            <input value={jobRef} onChange={e => setJobRef(e.target.value)} placeholder="Job reference (e.g. Overnight load-out 11pm–7am)" style={{ ...inp, marginTop: 8 }} />
          </div>

          <div style={cardS}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div><span style={lbl}>Invoice #</span><input value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} style={inp} /></div>
              <div><span style={lbl}>Date</span><input value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} style={inp} /></div>
              <div><span style={lbl}>Terms</span>
                <select value={terms} onChange={e => setTerms(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
                  <option>Due on receipt</option><option>Net 15</option><option>Net 30</option><option>Net 45</option>
                </select>
              </div>
            </div>
          </div>

          <div style={cardS}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ ...lbl, marginBottom: 0 }}>Line Items — crew × hours × bill rate</span>
              <button onClick={addLine} style={{ background: "#E8C84A", color: "#1a1400", border: "none", borderRadius: 7, padding: "7px 12px", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>+ ADD LINE</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {lines.map(l => (
                <div key={l.id} style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: 8, padding: 10 }}>
                  <input value={l.description} onChange={e => setLine(l.id, { description: e.target.value })} placeholder="Description (e.g. General Labor — overnight crew)" style={{ ...inp, marginBottom: 8 }} />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto", gap: 6, alignItems: "end" }}>
                    <div><span style={lbl}>Crew</span><input inputMode="numeric" value={l.qty} onChange={e => setLine(l.id, { qty: e.target.value })} style={{ ...inp, textAlign: "center" }} /></div>
                    <div><span style={lbl}>Hrs each</span><input inputMode="decimal" value={l.hours} onChange={e => setLine(l.id, { hours: e.target.value })} style={{ ...inp, textAlign: "center" }} /></div>
                    <div><span style={lbl}>$/hr</span><input inputMode="decimal" value={l.rate} onChange={e => setLine(l.id, { rate: e.target.value })} style={{ ...inp, textAlign: "center" }} /></div>
                    <div><span style={lbl}>OT hrs</span><input inputMode="decimal" value={l.otHours} onChange={e => setLine(l.id, { otHours: e.target.value })} style={{ ...inp, textAlign: "center" }} /></div>
                    <button onClick={() => removeLine(l.id)} title="Remove line" style={{ background: "transparent", border: "1px solid #e5b0b0", color: "#c33", borderRadius: 7, padding: "9px 11px", cursor: "pointer", fontFamily: "inherit" }}>✕</button>
                  </div>
                  <div style={{ textAlign: "right", fontSize: 12, marginTop: 8, color: "#555" }}>
                    {num(l.qty)} × {num(l.hours)}h × {money(num(l.rate))}
                    {num(l.otHours) > 0 ? ` + OT ${num(l.otHours)}h @ 1.5×` : ""} = <b style={{ color: "#111" }}>{money(lineTotal(l))}</b>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
              <div><span style={lbl}>Tax %</span><input inputMode="decimal" value={taxPct} onChange={e => setTaxPct(e.target.value)} style={{ ...inp, textAlign: "center" }} /></div>
              <div style={{ alignSelf: "end", textAlign: "right", fontSize: 13 }}>
                Subtotal <b>{money(subtotal)}</b>{num(taxPct) > 0 ? <> · Tax <b>{money(tax)}</b></> : null}
              </div>
            </div>
          </div>

          <div style={cardS}>
            <span style={lbl}>Invoice notes</span>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} style={{ ...inp, minHeight: 56, resize: "vertical" }} />
          </div>
        </div>

        {/* ── RIGHT: LIVE PREVIEW + GENERATE ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ ...cardS, border: "2px solid #E8C84A" }}>
            <span style={lbl}>Live preview</span>
            <div style={{ background: "#fff", border: "1px solid #ddd", borderRadius: 8, padding: 18, fontFamily: "-apple-system,'Helvetica Neue',Arial,sans-serif" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
                <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: "0.04em" }}>BIG CREW NYC</div>
                <div style={{ textAlign: "right", fontSize: 12 }}>
                  <div style={{ fontWeight: 700 }}>{invoiceNo}</div>
                  <div>{invoiceDate} · {terms}</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: "#888", letterSpacing: "0.15em", marginBottom: 2 }}>BILL TO</div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{client || "—"}</div>
              <div style={{ fontSize: 12, whiteSpace: "pre-line", color: "#444", marginBottom: 12 }}>{clientAddress}</div>
              {jobRef.trim() && <div style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>Re: {jobRef}</div>}
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr style={{ background: "#111", color: "#fff" }}>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>Description</th>
                  <th style={{ padding: "6px 4px" }}>Crew</th>
                  <th style={{ padding: "6px 4px" }}>Hrs</th>
                  <th style={{ textAlign: "right", padding: "6px 8px" }}>Amount</th>
                </tr></thead>
                <tbody>
                  {lines.map(l => (
                    <tr key={l.id} style={{ borderBottom: "1px solid #eee" }}>
                      <td style={{ padding: "7px 8px" }}>{l.description || "Labor"}{num(l.otHours) > 0 && <div style={{ fontSize: 10, color: "#888" }}>+ {l.otHours} OT hrs @ 1.5×</div>}</td>
                      <td style={{ textAlign: "center" }}>{l.qty}</td>
                      <td style={{ textAlign: "center" }}>{l.hours}</td>
                      <td style={{ textAlign: "right", padding: "7px 8px" }}>{money(lineTotal(l))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                <div style={{ minWidth: 180, fontSize: 13 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}><span>Subtotal</span><span>{money(subtotal)}</span></div>
                  {num(taxPct) > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}><span>Tax ({taxPct}%)</span><span>{money(tax)}</span></div>}
                  <div style={{ display: "flex", justifyContent: "space-between", borderTop: "2px solid #111", marginTop: 4, paddingTop: 5, fontWeight: 800, fontSize: 15 }}>
                    <span>TOTAL DUE</span><span>{money(total)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <button onClick={printInvoice}
            style={{ background: "#0a8f5b", color: "#fff", border: "none", borderRadius: 9, padding: 16, fontWeight: 800, fontSize: 14, letterSpacing: "0.08em", cursor: "pointer", fontFamily: "inherit" }}>
            🧾 GENERATE INVOICE (PRINT / SAVE PDF)
          </button>
          <div style={{ fontSize: 10, color: "#999", textAlign: "center", lineHeight: 1.5 }}>
            Opens a print-ready invoice — use your browser&apos;s &quot;Save as PDF&quot; to email it to the client.
          </div>
        </div>
      </div>
    </div>
  );
}
