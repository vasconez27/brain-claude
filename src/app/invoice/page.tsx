"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

// Light/dark palettes for the tool chrome. The invoice PREVIEW and PRINT stay
// white paper on purpose — that's the document the client receives.
const PALETTE = {
  light: { pageBg: "#f2f2f2", cardBg: "#fafafa", cardBorder: "#e4e4e4", inputBg: "#fff", inputBorder: "#d0d0d0", text: "#111", muted: "#666", faint: "#999", headerBg: "#fff", rowBg: "#fff", rowBorder: "#e0e0e0" },
  dark: { pageBg: "#0c0c0d", cardBg: "#151517", cardBorder: "#2c2c30", inputBg: "#1a1a1d", inputBorder: "#3c3c42", text: "#ededed", muted: "#9a9a9a", faint: "#6a6a6a", headerBg: "#151517", rowBg: "#1d1d20", rowBorder: "#2c2c30" },
};

// ─── BIG CREW INVOICING ──────────────────────────────────────────────────────
// Standalone billing tool. Reads the roster + billing config from the shared
// workspace (manager-only — the server strips billing for crew sessions).
// Three ways to build an invoice:
//   1. PASTE the client's message ("I need 6 people 8am-6pm") → auto-parsed,
//      hours computed, OT split by the same night-window + 10hr rule as pay.
//   2. PICK CREW from the roster → each person's saved bill rate, CC +$4.
//   3. ITEMS from a growing catalog (stage deck, trucking...).
// The client-facing invoice is ROLLED UP — never individual crew names.

type Rec = Record<string, any>;
type CrewPick = { rosterId: string; name: string; cc: boolean };
type Item = { id: string; name: string; price: number };
type LaborLine = { id: number; label: string; qty: number; regHours: number; otHours: number; rate: number };
type ItemLine = { id: number; name: string; qty: number; price: number };

const CC_PREMIUM = 4; // dollars/hr on top of the person's own rate

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nnum = (v: any, d = 0) => { const x = parseFloat(v); return isNaN(x) || x < 0 ? d : x; };
const today = () => new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
const invNumber = () => {
  const d = new Date();
  return `INV-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
};
let nid = 100;

// Parse "3pm", "11:30 pm", "8am" → hour float (0–24)
function parseClock(s: string): number | null {
  const m = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  let h = parseInt(m[1]); const min = m[2] ? parseInt(m[2]) : 0;
  const ap = (m[3] || "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return h + min / 60;
}

// Split a time range into regular vs OT hours using the SAME rule as crew pay:
// any hour inside 12am–8am is OT, and anything past the 10th cumulative hour
// is OT (union, no double count). Walks in 15-min steps.
function splitHours(startH: number, endH: number): { total: number; reg: number; ot: number } {
  let end = endH; if (end <= startH) end += 24; // overnight rollover
  let reg = 0, ot = 0, elapsed = 0;
  for (let t = startH; t < end - 1e-9; t += 0.25) {
    const hourOfDay = ((t % 24) + 24) % 24;
    const night = hourOfDay >= 0 && hourOfDay < 8;
    const pastTen = elapsed >= 10;
    if (night || pastTen) ot += 0.25; else reg += 0.25;
    elapsed += 0.25;
  }
  return { total: reg + ot, reg: Math.round(reg * 100) / 100, ot: Math.round(ot * 100) / 100 };
}

// Parse the client's message: "I need 6 people 8am-6pm" → {count, startH, endH, times}
function parseRequest(text: string): { count: number; startH: number; endH: number; timeLabel: string } | null {
  const cnt = text.match(/(\d+)\s*(?:people|guys|ppl|men|crew|workers|hands|laborers|persons?)/i);
  const range = text.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*(?:-|–|—|to|till|until)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);
  if (!cnt && !range) return null;
  const count = cnt ? parseInt(cnt[1]) : 1;
  const startH = range ? parseClock(range[1]) : null;
  const endH = range ? parseClock(range[2]) : null;
  if (startH == null || endH == null) return { count, startH: 9, endH: 17, timeLabel: "" };
  return { count, startH, endH, timeLabel: `${range![1].toUpperCase()} – ${range![2].toUpperCase()}` };
}

const lineAmount = (l: LaborLine) => l.qty * (l.regHours * l.rate + l.otHours * l.rate * 1.5);

export default function InvoicePage() {
  // ── theme (light/dark, gated on mount to avoid hydration mismatch) ──
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const T = PALETTE[mounted && resolvedTheme === "dark" ? "dark" : "light"];

  // ── load workspace: roster + billing config ──
  const [loaded, setLoaded] = useState(false);
  const [splash, setSplash] = useState(true);
  const [roster, setRoster] = useState<Rec[]>([]);
  const [billing, setBilling] = useState<Rec>({ defaultRate: 38, rates: {}, items: [] });
  const [saveMsg, setSaveMsg] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setSplash(false), 1100); // b. beat, then the tool
    fetch("/api/workspace", { cache: "no-store" }).then(r => r.json()).then(j => {
      const d = j?.data || {};
      setRoster((d.roster || []).filter((r: Rec) => r.active !== false));
      if (d.billing) setBilling({ defaultRate: 38, rates: {}, items: [], ...d.billing });
      setLoaded(true);
    }).catch(() => setLoaded(true));
    return () => clearTimeout(t);
  }, []);

  // Persist billing config (rates/catalog) back to the workspace. Fetch-fresh
  // then PUT so we merge with the latest rather than clobbering.
  async function saveBilling(next: Rec) {
    setBilling(next);
    try {
      const cur = await fetch("/api/workspace", { cache: "no-store" }).then(r => r.json());
      const data = { ...(cur?.data || {}), billing: next };
      delete data.managerContacts; // derived, never persisted
      await fetch("/api/workspace", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      setSaveMsg("✓ saved"); setTimeout(() => setSaveMsg(""), 1500);
    } catch { setSaveMsg("save failed"); }
  }

  const rateFor = (rosterId: string) => nnum(billing.rates?.[rosterId], nnum(billing.defaultRate, 38));

  // ── invoice state ──
  const [client, setClient] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [jobRef, setJobRef] = useState("");
  const [invoiceNo, setInvoiceNo] = useState(invNumber());
  const [invoiceDate, setInvoiceDate] = useState(today());
  const [terms, setTerms] = useState("Net 30");
  const [taxPct, setTaxPct] = useState("0");
  const [notes, setNotes] = useState("Thank you for your business. Please reference the invoice number with payment.");

  const [laborLines, setLaborLines] = useState<LaborLine[]>([]);
  const [itemLines, setItemLines] = useState<ItemLine[]>([]);

  // paste mode
  const [paste, setPaste] = useState("");
  const [pasteMsg, setPasteMsg] = useState("");

  // crew mode
  const [picks, setPicks] = useState<CrewPick[]>([]);
  const [crewSearch, setCrewSearch] = useState("");
  const [crewStart, setCrewStart] = useState("8am");
  const [crewEnd, setCrewEnd] = useState("6pm");

  // rates drawer + item form
  const [showRates, setShowRates] = useState(false);
  const [newItem, setNewItem] = useState({ name: "", price: "" });

  // ── actions ──
  function runPaste() {
    const p = parseRequest(paste);
    if (!p) { setPasteMsg("Couldn't find a crew count or time range — e.g. \"6 people 8am-6pm\""); return; }
    const s = splitHours(p.startH, p.endH);
    setLaborLines(ls => [...ls, {
      id: nid++, label: "General Labor", qty: p.count,
      regHours: s.reg, otHours: s.ot, rate: nnum(billing.defaultRate, 38),
    }]);
    if (p.timeLabel && !jobRef) setJobRef(`Labor call · ${p.timeLabel}`);
    setPasteMsg(`✓ ${p.count} crew · ${s.total} hrs each${s.ot > 0 ? ` (${s.reg} reg + ${s.ot} OT auto-split)` : ""}`);
    setPaste("");
  }

  function addPicksToInvoice() {
    const sH = parseClock(crewStart), eH = parseClock(crewEnd);
    if (sH == null || eH == null || picks.length === 0) return;
    const s = splitHours(sH, eH);
    // Roll up: group by (cc, effective rate) — names stay internal.
    const groups = new Map<string, { label: string; qty: number; rate: number }>();
    for (const pk of picks) {
      const rate = rateFor(pk.rosterId) + (pk.cc ? CC_PREMIUM : 0);
      const key = `${pk.cc ? "CC" : "GL"}|${rate}`;
      const g = groups.get(key) || { label: pk.cc ? "Crew Captain" : "General Labor", qty: 0, rate };
      g.qty += 1; groups.set(key, g);
    }
    setLaborLines(ls => [...ls, ...[...groups.values()].map(g => ({
      id: nid++, label: g.label, qty: g.qty, regHours: s.reg, otHours: s.ot, rate: g.rate,
    }))]);
    setPicks([]);
  }

  function addCatalogItem(it: Item) {
    setItemLines(ls => {
      const ex = ls.find(l => l.name === it.name && l.price === it.price);
      if (ex) return ls.map(l => l === ex ? { ...l, qty: l.qty + 1 } : l);
      return [...ls, { id: nid++, name: it.name, qty: 1, price: it.price }];
    });
  }

  function addNewItem() {
    const name = newItem.name.trim(); const price = nnum(newItem.price, -1);
    if (!name || price < 0) return;
    const it: Item = { id: String(nid++), name, price };
    saveBilling({ ...billing, items: [...(billing.items || []), it] }); // catalog grows
    addCatalogItem(it);
    setNewItem({ name: "", price: "" });
  }

  const laborTotal = laborLines.reduce((a, l) => a + lineAmount(l), 0);
  const itemsTotal = itemLines.reduce((a, l) => a + l.qty * l.price, 0);
  const subtotal = laborTotal + itemsTotal;
  const tax = subtotal * (nnum(taxPct) / 100);
  const total = subtotal + tax;

  // ── print (real logo, rolled-up lines only) ──
  function printInvoice() {
    const laborRows = laborLines.map(l => `
      <tr><td>${l.label}${l.otHours > 0 ? `<div class="sub">${l.regHours} reg + ${l.otHours} OT hrs each (OT @ 1.5×)</div>` : ""}</td>
      <td class="c">${l.qty}</td><td class="c">${l.regHours + l.otHours}</td>
      <td class="r">${money(l.rate)}/hr</td><td class="r">${money(lineAmount(l))}</td></tr>`).join("");
    const itemRows = itemLines.map(l => `
      <tr><td>${l.name.replace(/[<>]/g, "")}</td><td class="c">${l.qty}</td><td class="c">—</td>
      <td class="r">${money(l.price)}</td><td class="r">${money(l.qty * l.price)}</td></tr>`).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${invoiceNo}</title>
    <style>
      @page { margin: 0.7in; }
      body { font-family: -apple-system,'Helvetica Neue',Arial,sans-serif; color:#111; font-size:11pt; line-height:1.5; }
      .top { display:flex; justify-content:space-between; align-items:center; margin-bottom:24pt; }
      .brand { display:flex; align-items:center; gap:12pt; }
      .brand img { width:64pt; height:64pt; object-fit:contain; }
      .brand .nm { font-size:19pt; font-weight:800; letter-spacing:0.05em; }
      .brand small { display:block; font-size:8pt; font-weight:400; letter-spacing:0.22em; color:#777; margin-top:2pt; }
      .invmeta { text-align:right; font-size:10pt; }
      .invmeta .no { font-size:14pt; font-weight:700; }
      h1 { font-size:15pt; letter-spacing:0.15em; margin:0 0 12pt; }
      .ref { color:#666; font-size:9.5pt; margin:-8pt 0 16pt; }
      .party .label { font-size:8pt; letter-spacing:0.18em; color:#888; text-transform:uppercase; margin-bottom:3pt; }
      .party { margin-bottom:18pt; } .party div { white-space:pre-line; }
      table { width:100%; border-collapse:collapse; font-size:10pt; margin-bottom:14pt; }
      th { text-align:left; background:#111; color:#fff; padding:7pt 9pt; font-size:8.5pt; letter-spacing:0.1em; }
      td { padding:8pt 9pt; border-bottom:1px solid #ddd; vertical-align:top; }
      td.c, th.c { text-align:center; } td.r, th.r { text-align:right; }
      .sub { font-size:8.5pt; color:#666; margin-top:2pt; }
      .totals { margin-left:auto; width:45%; font-size:10.5pt; }
      .totals div { display:flex; justify-content:space-between; padding:4pt 9pt; }
      .totals .grand { border-top:2px solid #111; font-size:13pt; font-weight:800; padding-top:7pt; margin-top:3pt; }
      .notes { margin-top:24pt; font-size:9.5pt; color:#555; border-top:1px solid #ddd; padding-top:10pt; white-space:pre-line; }
    </style></head><body>
      <div class="top">
        <div class="brand">
          <img src="${location.origin}/bigcrew-logo-circle.webp" alt="">
          <div class="nm">BIG CREW NYC<small>CREW &amp; LABOR SERVICES</small></div>
        </div>
        <div class="invmeta"><div class="no">${invoiceNo}</div><div>Date: ${invoiceDate}</div><div>Terms: ${terms}</div></div>
      </div>
      <h1>INVOICE</h1>
      ${jobRef.trim() ? `<div class="ref">Re: ${jobRef.replace(/[<>]/g, "")}</div>` : ""}
      <div class="party"><div class="label">Bill To</div><div><b>${client.replace(/[<>]/g, "")}</b>\n${clientAddress.replace(/[<>]/g, "")}</div></div>
      <table>
        <thead><tr><th>Description</th><th class="c">Qty</th><th class="c">Hrs Each</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
        <tbody>${laborRows}${itemRows}</tbody>
      </table>
      <div class="totals">
        <div><span>Subtotal</span><span>${money(subtotal)}</span></div>
        ${nnum(taxPct) > 0 ? `<div><span>Tax (${taxPct}%)</span><span>${money(tax)}</span></div>` : ""}
        <div class="grand"><span>TOTAL DUE</span><span>${money(total)}</span></div>
      </div>
      ${notes.trim() ? `<div class="notes">${notes.replace(/[<>]/g, "")}</div>` : ""}
      <script>window.onload=()=>setTimeout(()=>window.print(),150)</script>
    </body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  }

  // ── styles (theme-driven) ──
  const inp: React.CSSProperties = { width: "100%", padding: "10px 12px", fontSize: 14, borderRadius: 7, border: `2px solid ${T.inputBorder}`, background: T.inputBg, color: T.text, fontFamily: "'DM Mono','Courier New',monospace", outline: "none", boxSizing: "border-box" };
  const lbl: React.CSSProperties = { display: "block", fontSize: 10, letterSpacing: "0.18em", color: T.faint, textTransform: "uppercase", fontWeight: 700, marginBottom: 4 };
  const cardS: React.CSSProperties = { background: T.cardBg, border: `2px solid ${T.cardBorder}`, borderRadius: 10, padding: 14 };
  const goldBtn: React.CSSProperties = { background: "#E8C84A", color: "#1a1400", border: "none", borderRadius: 7, padding: "9px 14px", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.05em" };
  const rowS: React.CSSProperties = { background: T.rowBg, border: `1px solid ${T.rowBorder}`, borderRadius: 7 };

  const filteredRoster = roster.filter(r =>
    !picks.find(p => p.rosterId === r.id) &&
    (crewSearch.trim() === "" || (r.name || "").toLowerCase().includes(crewSearch.toLowerCase()))
  ).slice(0, 6);

  return (
    <div style={{ minHeight: "100vh", background: T.pageBg, color: T.text, fontFamily: "'DM Mono','Courier New',monospace", paddingBottom: 60 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Bebas+Neue&display=swap');
        @media (min-width: 980px) { .inv-grid { display:grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: start; } }
        @keyframes bfade { 0%{opacity:1} 75%{opacity:1} 100%{opacity:0} }
      `}</style>

      {/* b. splash — same signature beat as the crew app's entrance */}
      {splash && (
        <div style={{ position: "fixed", inset: 0, zIndex: 999, background: "#ce2c1f", display: "flex", alignItems: "center", justifyContent: "center", animation: "bfade 1.1s ease forwards", pointerEvents: "none" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/b-brand.webp" alt="" style={{ width: 180, height: 180, objectFit: "contain" }} />
        </div>
      )}

      {/* Header */}
      <div style={{ background: T.headerBg, borderBottom: "2px solid #E8C84A", padding: "12px 16px", position: "sticky", top: 0, zIndex: 50, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bigcrew-logo-circle.webp" alt="" style={{ width: 38, height: 38, objectFit: "contain" }} />
          <div>
            <div style={{ fontFamily: "'Bebas Neue','Arial Black',sans-serif", fontSize: 22, letterSpacing: "0.1em" }}>BIG CREW INVOICING</div>
            <div style={{ fontSize: 9, color: T.faint, letterSpacing: "0.2em" }}>BILLING · MANAGEMENT ONLY</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {saveMsg && <span style={{ fontSize: 10, color: saveMsg.startsWith("✓") ? "#0a8f5b" : "#c33" }}>{saveMsg}</span>}
          <button onClick={() => setShowRates(v => !v)} style={{ ...goldBtn, background: showRates ? "#111" : "#E8C84A", color: showRates ? "#fff" : "#1a1400" }}>⚙ RATES</button>
          <a href="/manager/dashboard" style={{ fontSize: 11, color: T.muted, textDecoration: "none", border: `1px solid ${T.cardBorder}`, borderRadius: 7, padding: "8px 12px", background: T.cardBg }}>← APP</a>
        </div>
      </div>

      <div style={{ maxWidth: 1150, margin: "0 auto", padding: "16px 14px" }}>

        {/* ── RATES & CATALOG DRAWER ── */}
        {showRates && (
          <div style={{ ...cardS, border: `2px solid ${T.inputBorder}`, marginBottom: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <span style={lbl}>Default bill rate ($/hr) · CC always bills +${CC_PREMIUM}</span>
                <input inputMode="decimal" value={billing.defaultRate ?? 38}
                  onChange={e => setBilling((b: Rec) => ({ ...b, defaultRate: e.target.value }))}
                  onBlur={() => saveBilling({ ...billing, defaultRate: nnum(billing.defaultRate, 38) })}
                  style={{ ...inp, width: 120, textAlign: "center" }} />
                <div style={{ marginTop: 12 }}>
                  <span style={lbl}>Per-person rates (blank = default) — internal only, never shown to crew or client</span>
                  <div style={{ maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                    {roster.map(r => (
                      <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: T.rowBg, border: `1px solid ${T.rowBorder}`, borderRadius: 7, padding: "7px 10px" }}>
                        <span style={{ fontSize: 12, fontWeight: 700 }}>{r.name}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <span style={{ fontSize: 11, color: T.faint }}>$</span>
                          <input inputMode="decimal" placeholder={String(nnum(billing.defaultRate, 38))}
                            value={billing.rates?.[r.id] ?? ""}
                            onChange={e => setBilling((b: Rec) => ({ ...b, rates: { ...(b.rates || {}), [r.id]: e.target.value } }))}
                            onBlur={() => {
                              const v = billing.rates?.[r.id];
                              const rates = { ...(billing.rates || {}) };
                              if (v === "" || v == null) delete rates[r.id]; else rates[r.id] = nnum(v, nnum(billing.defaultRate, 38));
                              saveBilling({ ...billing, rates });
                            }}
                            style={{ ...inp, width: 74, textAlign: "center", padding: "6px 8px" }} />
                          <span style={{ fontSize: 10, color: T.faint }}>/hr</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div>
                <span style={lbl}>Services & items catalog (saved — pick from list on any invoice)</span>
                <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                  <input value={newItem.name} onChange={e => setNewItem(s => ({ ...s, name: e.target.value }))} placeholder="e.g. Stage Deck Rental" style={inp} />
                  <input inputMode="decimal" value={newItem.price} onChange={e => setNewItem(s => ({ ...s, price: e.target.value }))} placeholder="$" style={{ ...inp, width: 90, textAlign: "center" }} />
                  <button onClick={addNewItem} style={goldBtn}>SAVE</button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 240, overflowY: "auto" }}>
                  {(billing.items || []).map((it: Item) => (
                    <div key={it.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: T.rowBg, border: `1px solid ${T.rowBorder}`, borderRadius: 7, padding: "7px 10px" }}>
                      <span style={{ fontSize: 12 }}>{it.name} — <b>{money(it.price)}</b></span>
                      <button onClick={() => saveBilling({ ...billing, items: (billing.items || []).filter((x: Item) => x.id !== it.id) })}
                        style={{ background: "transparent", border: "1px solid #e5b0b0", color: "#c33", borderRadius: 6, padding: "3px 8px", cursor: "pointer", fontFamily: "inherit", fontSize: 10 }}>✕</button>
                    </div>
                  ))}
                  {(billing.items || []).length === 0 && <div style={{ fontSize: 11, color: T.faint }}>No items saved yet — add your first above.</div>}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="inv-grid">
          {/* ── LEFT: BUILD ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

            {/* 1 · PASTE THE CLIENT'S MESSAGE */}
            <div style={{ ...cardS, border: "2px dashed #E8C84A", background: "#fdf9ea" }}>
              <span style={lbl}>⚡ Paste the client's message — auto-builds the line</span>
              <textarea value={paste} onChange={e => setPaste(e.target.value)}
                placeholder={'e.g. "Hey can I get 6 people 8am-6pm Saturday"\nor "I need 5 guys 11pm-7am" (OT auto-splits)'}
                style={{ ...inp, minHeight: 64, resize: "vertical", fontFamily: "monospace", fontSize: 12 }} />
              <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                <button onClick={runPaste} disabled={!paste.trim()} style={{ ...goldBtn, opacity: paste.trim() ? 1 : 0.5 }}>⚡ AUTO-FILL</button>
                {pasteMsg && <span style={{ fontSize: 11, color: pasteMsg.startsWith("✓") ? "#0a8f5b" : "#c33" }}>{pasteMsg}</span>}
              </div>
            </div>

            {/* 2 · PICK CREW FROM ROSTER */}
            <div style={cardS}>
              <span style={lbl}>👥 Or pick crew — saved rates, CC bills +${CC_PREMIUM} (names never appear on the invoice)</span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 100px", gap: 6, marginBottom: 8 }}>
                <input value={crewSearch} onChange={e => setCrewSearch(e.target.value)} placeholder="Type a name…" style={inp} />
                <input value={crewStart} onChange={e => setCrewStart(e.target.value)} placeholder="8am" style={{ ...inp, textAlign: "center" }} />
                <input value={crewEnd} onChange={e => setCrewEnd(e.target.value)} placeholder="6pm" style={{ ...inp, textAlign: "center" }} />
              </div>
              {crewSearch.trim() !== "" && filteredRoster.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                  {filteredRoster.map(r => (
                    <button key={r.id} onClick={() => { setPicks(p => [...p, { rosterId: r.id, name: r.name, cc: false }]); setCrewSearch(""); }}
                      style={{ background: T.rowBg, border: `1px solid ${T.inputBorder}`, borderRadius: 7, padding: "7px 11px", cursor: "pointer", fontFamily: "inherit", fontSize: 12 }}>
                      + {r.name} <span style={{ color: T.faint, fontSize: 10 }}>({money(rateFor(r.id))}/hr)</span>
                    </button>
                  ))}
                </div>
              )}
              {picks.length > 0 && (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                    {picks.map((p, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: T.rowBg, border: `1px solid ${T.rowBorder}`, borderRadius: 7, padding: "7px 10px" }}>
                        <span style={{ fontSize: 12, fontWeight: 700 }}>{p.name} <span style={{ color: T.faint, fontWeight: 400 }}>{money(rateFor(p.rosterId) + (p.cc ? CC_PREMIUM : 0))}/hr</span></span>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => setPicks(ps => ps.map((x, j) => j === i ? { ...x, cc: !x.cc } : x))}
                            style={{ background: p.cc ? "#E8C84A" : "transparent", border: "1px solid #E8C84A", color: p.cc ? "#1a1400" : "#a08a20", borderRadius: 6, padding: "3px 9px", cursor: "pointer", fontFamily: "inherit", fontSize: 10, fontWeight: 700 }}>CC</button>
                          <button onClick={() => setPicks(ps => ps.filter((_, j) => j !== i))}
                            style={{ background: "transparent", border: "1px solid #e5b0b0", color: "#c33", borderRadius: 6, padding: "3px 8px", cursor: "pointer", fontFamily: "inherit", fontSize: 10 }}>✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button onClick={addPicksToInvoice} style={{ ...goldBtn, width: "100%", padding: 12 }}>＋ ADD {picks.length} CREW TO INVOICE ({crewStart}–{crewEnd})</button>
                </>
              )}
            </div>

            {/* 3 · ITEMS */}
            {(billing.items || []).length > 0 && (
              <div style={cardS}>
                <span style={lbl}>📦 Services & items — tap to add</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {(billing.items || []).map((it: Item) => (
                    <button key={it.id} onClick={() => addCatalogItem(it)}
                      style={{ background: T.rowBg, border: `1px solid ${T.inputBorder}`, borderRadius: 7, padding: "8px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: 12 }}>
                      + {it.name} <b>{money(it.price)}</b>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* CLIENT + META */}
            <div style={cardS}>
              <span style={lbl}>Bill to</span>
              <input value={client} onChange={e => setClient(e.target.value)} placeholder="Client / company name" style={inp} />
              <textarea value={clientAddress} onChange={e => setClientAddress(e.target.value)} placeholder="Billing address" style={{ ...inp, marginTop: 8, minHeight: 52, resize: "vertical" }} />
              <input value={jobRef} onChange={e => setJobRef(e.target.value)} placeholder="Job reference (optional)" style={{ ...inp, marginTop: 8 }} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 80px", gap: 8, marginTop: 8 }}>
                <div><span style={lbl}>Invoice #</span><input value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} style={inp} /></div>
                <div><span style={lbl}>Date</span><input value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} style={inp} /></div>
                <div><span style={lbl}>Terms</span>
                  <select value={terms} onChange={e => setTerms(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
                    <option>Due on receipt</option><option>Net 15</option><option>Net 30</option><option>Net 45</option>
                  </select></div>
                <div><span style={lbl}>Tax %</span><input inputMode="decimal" value={taxPct} onChange={e => setTaxPct(e.target.value)} style={{ ...inp, textAlign: "center" }} /></div>
              </div>
              <div style={{ marginTop: 8 }}>
                <span style={lbl}>Invoice notes</span>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} style={{ ...inp, minHeight: 48, resize: "vertical" }} />
              </div>
            </div>
          </div>

          {/* ── RIGHT: LINES + PREVIEW + GENERATE ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
            <div style={{ ...cardS, border: "2px solid #E8C84A" }}>
              <span style={lbl}>Invoice lines (rolled up — no crew names)</span>
              {laborLines.length === 0 && itemLines.length === 0 && (
                <div style={{ fontSize: 12, color: T.faint, padding: "14px 0" }}>Nothing yet — paste a request, pick crew, or tap an item.</div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {laborLines.map(l => (
                  <div key={l.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: T.rowBg, border: `1px solid ${T.rowBorder}`, borderRadius: 7, padding: "8px 10px" }}>
                    <div style={{ fontSize: 12 }}>
                      <b>{l.label}</b> — {l.qty} crew × {l.regHours + l.otHours}h @ {money(l.rate)}/hr
                      {l.otHours > 0 && <div style={{ fontSize: 10, color: T.faint }}>{l.regHours} reg + {l.otHours} OT @1.5×</div>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <b style={{ fontSize: 13 }}>{money(lineAmount(l))}</b>
                      <button onClick={() => setLaborLines(ls => ls.filter(x => x.id !== l.id))} style={{ background: "transparent", border: "1px solid #e5b0b0", color: "#c33", borderRadius: 6, padding: "3px 8px", cursor: "pointer", fontFamily: "inherit", fontSize: 10 }}>✕</button>
                    </div>
                  </div>
                ))}
                {itemLines.map(l => (
                  <div key={l.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: T.rowBg, border: `1px solid ${T.rowBorder}`, borderRadius: 7, padding: "8px 10px" }}>
                    <div style={{ fontSize: 12 }}><b>{l.name}</b> × {l.qty}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <b style={{ fontSize: 13 }}>{money(l.qty * l.price)}</b>
                      <button onClick={() => setItemLines(ls => ls.filter(x => x.id !== l.id))} style={{ background: "transparent", border: "1px solid #e5b0b0", color: "#c33", borderRadius: 6, padding: "3px 8px", cursor: "pointer", fontFamily: "inherit", fontSize: 10 }}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ textAlign: "right", marginTop: 12, fontSize: 13 }}>
                Subtotal <b>{money(subtotal)}</b>
                {nnum(taxPct) > 0 && <> · Tax <b>{money(tax)}</b></>}
                <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>TOTAL DUE {money(total)}</div>
              </div>
            </div>

            {/* ── LIVE PREVIEW — white paper, exactly what prints (rolled up) ── */}
            <div style={{ ...cardS, border: "2px solid #E8C84A" }}>
              <span style={lbl}>Live preview — what the client receives</span>
              <div style={{ background: "#fff", color: "#111", border: "1px solid #ddd", borderRadius: 8, padding: 18, fontFamily: "-apple-system,'Helvetica Neue',Arial,sans-serif" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/bigcrew-logo-circle.webp" alt="" style={{ width: 40, height: 40, objectFit: "contain" }} />
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: "0.04em" }}>BIG CREW NYC</div>
                      <div style={{ fontSize: 7, letterSpacing: "0.22em", color: "#888" }}>CREW &amp; LABOR SERVICES</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right", fontSize: 11 }}>
                    <div style={{ fontWeight: 700 }}>{invoiceNo}</div>
                    <div style={{ color: "#555" }}>{invoiceDate} · {terms}</div>
                  </div>
                </div>
                <div style={{ fontSize: 13, letterSpacing: "0.14em", fontWeight: 700, marginBottom: 6 }}>INVOICE</div>
                {jobRef.trim() && <div style={{ fontSize: 11, color: "#666", marginBottom: 10 }}>Re: {jobRef}</div>}
                <div style={{ fontSize: 8, color: "#888", letterSpacing: "0.15em", marginBottom: 2 }}>BILL TO</div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{client || <span style={{ color: "#bbb", fontWeight: 400 }}>Client name…</span>}</div>
                <div style={{ fontSize: 11, whiteSpace: "pre-line", color: "#444", marginBottom: 12 }}>{clientAddress}</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead><tr style={{ background: "#111", color: "#fff" }}>
                    <th style={{ textAlign: "left", padding: "5px 7px", fontWeight: 600 }}>Description</th>
                    <th style={{ padding: "5px 4px" }}>Qty</th>
                    <th style={{ padding: "5px 4px" }}>Hrs</th>
                    <th style={{ textAlign: "right", padding: "5px 7px" }}>Amount</th>
                  </tr></thead>
                  <tbody>
                    {laborLines.map(l => (
                      <tr key={l.id} style={{ borderBottom: "1px solid #eee" }}>
                        <td style={{ padding: "6px 7px" }}>{l.label}{l.otHours > 0 && <div style={{ fontSize: 9, color: "#888" }}>{l.regHours} reg + {l.otHours} OT @1.5×</div>}</td>
                        <td style={{ textAlign: "center" }}>{l.qty}</td>
                        <td style={{ textAlign: "center" }}>{l.regHours + l.otHours}</td>
                        <td style={{ textAlign: "right", padding: "6px 7px" }}>{money(lineAmount(l))}</td>
                      </tr>
                    ))}
                    {itemLines.map(l => (
                      <tr key={l.id} style={{ borderBottom: "1px solid #eee" }}>
                        <td style={{ padding: "6px 7px" }}>{l.name}</td>
                        <td style={{ textAlign: "center" }}>{l.qty}</td>
                        <td style={{ textAlign: "center" }}>—</td>
                        <td style={{ textAlign: "right", padding: "6px 7px" }}>{money(l.qty * l.price)}</td>
                      </tr>
                    ))}
                    {laborLines.length === 0 && itemLines.length === 0 && (
                      <tr><td colSpan={4} style={{ padding: "14px 7px", color: "#bbb", textAlign: "center" }}>No lines yet</td></tr>
                    )}
                  </tbody>
                </table>
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                  <div style={{ minWidth: 170, fontSize: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}><span>Subtotal</span><span>{money(subtotal)}</span></div>
                    {nnum(taxPct) > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}><span>Tax ({taxPct}%)</span><span>{money(tax)}</span></div>}
                    <div style={{ display: "flex", justifyContent: "space-between", borderTop: "2px solid #111", marginTop: 4, paddingTop: 5, fontWeight: 800, fontSize: 14 }}><span>TOTAL DUE</span><span>{money(total)}</span></div>
                  </div>
                </div>
              </div>
            </div>

            <button onClick={printInvoice} disabled={subtotal <= 0}
              style={{ background: subtotal > 0 ? "#0a8f5b" : "#bbb", color: "#fff", border: "none", borderRadius: 9, padding: 16, fontWeight: 800, fontSize: 14, letterSpacing: "0.08em", cursor: subtotal > 0 ? "pointer" : "default", fontFamily: "inherit" }}>
              🧾 GENERATE INVOICE (PRINT / SAVE PDF)
            </button>
            <div style={{ fontSize: 10, color: T.faint, textAlign: "center", lineHeight: 1.5 }}>
              Logo letterhead · rolled-up lines · use the browser&apos;s &quot;Save as PDF&quot; to email it.
              {!loaded && " · loading roster…"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
