"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTheme } from "next-themes";

// ─── STORAGE ─────────────────────────────────────────────────────────────────
// Backed by the shared /api/workspace document (Postgres) so every device sees
// the same live schedule. Falls back to null on any error → app shows empty state.
async function load() {
  try {
    const res = await fetch("/api/workspace", { cache: "no-store" });
    if (!res.ok) return null;
    const j = await res.json();
    return j ? { data: j.data ?? null, updatedAt: j.updatedAt ?? null } : null;
  } catch { return null; }
}
// Writes are serialized through a promise chain so rapid saves land in order
// (last write wins) instead of racing each other to the server.
// Resolves to { ok, updatedAt } so callers can surface failures and track the
// server's latest version (used to skip redundant poll updates).
let _saveChain = Promise.resolve();
async function save(d) {
  const body = JSON.stringify(d);
  _saveChain = _saveChain
    .then(() => fetch("/api/workspace", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
    }))
    .then(async res => (res && res.ok)
      ? { ok: true, updatedAt: (await res.json().catch(() => null))?.updatedAt ?? null }
      : { ok: false })
    .catch(e => { console.error(e); return { ok: false }; });
  return _saveChain;
}

// Fire-and-forget SMS ping through the server's Twilio route. Silently a
// no-op when Twilio isn't configured or the request fails — in-app
// notifications are the source of truth; SMS is just the wake-up tap.
function sendSMSPing(phones, body) {
  const clean = (phones || []).filter(Boolean);
  if (!clean.length || !body) return;
  fetch("/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phones: clean, body: body.slice(0, 1500) }),
  }).catch(() => {});
}

// ─── THEME ───────────────────────────────────────────────────────────────────
// Colors flow through CSS variables (set on <html> by applyTheme) so the whole
// app can switch between light and dark at runtime.
const C = {
  bg:"var(--bc-bg)", s1:"var(--bc-s1)", s2:"var(--bc-s2)", s3:"var(--bc-s3)",
  border:"var(--bc-border)", borderHi:"var(--bc-borderHi)",
  gold:"var(--bc-gold)", goldDim:"var(--bc-goldDim)", goldBg:"var(--bc-goldBg)",
  green:"var(--bc-green)", greenBg:"var(--bc-greenBg)",
  red:"var(--bc-red)", redBg:"var(--bc-redBg)",
  blue:"var(--bc-blue)", blueBg:"var(--bc-blueBg)",
  purple:"var(--bc-purple)", purpleBg:"var(--bc-purpleBg)",
  text:"var(--bc-text)", muted:"var(--bc-muted)", dim:"var(--bc-dim)",
  font:"'DM Mono','Courier New',monospace",
  head:"'Bebas Neue',sans-serif",
};

const THEMES = {
  light: { bg:"#ffffff", s1:"#fafafa", s2:"#f3f3f3", s3:"#e9e9e9", border:"#e4e4e4", borderHi:"#d0d0d0",
    gold:"#080808", goldDim:"#888888", goldBg:"#f0f0f0", green:"#0a8f5b", greenBg:"#e7f7ef",
    red:"#d83a3a", redBg:"#fdeaea", blue:"#1f6fd6", blueBg:"#e9f1fd", purple:"#6d4fd0", purpleBg:"#f0ebfb",
    text:"#0a0a0a", muted:"#666666", dim:"#9a9a9a", inpbg:"#ffffff", onaccent:"#ffffff", logofilter:"none" },
  dark:  { bg:"#0c0c0d", s1:"#151517", s2:"#1d1d20", s3:"#27272b", border:"#2c2c30", borderHi:"#3c3c42",
    gold:"#f2f2f2", goldDim:"#888888", goldBg:"#1e1e22", green:"#34d399", greenBg:"#0f2a20",
    red:"#f87171", redBg:"#2a1212", blue:"#60a5fa", blueBg:"#11243a", purple:"#a78bfa", purpleBg:"#1f1733",
    text:"#ededed", muted:"#9a9a9a", dim:"#6a6a6a", inpbg:"#1a1a1d", onaccent:"#0a0a0a", logofilter:"invert(1)" },
};

function applyTheme(name) {
  if (typeof document === "undefined") return;
  const t = THEMES[name] || THEMES.light;
  const root = document.documentElement;
  Object.entries(t).forEach(([k, v]) => root.style.setProperty("--bc-" + k, v));
  root.dataset.bcTheme = name;
  root.style.colorScheme = name; // native controls (date pickers, scrollbars) follow theme
}

const uid = () => Math.random().toString(36).slice(2,9);
const now = () => new Date().toISOString();
const fmt = ts => ts ? new Date(ts).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}) : "—";
const fmtDate = ts => ts ? new Date(ts).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "—";
const initials = n => n.split(" ").map(x=>x[0]).join("").slice(0,2).toUpperCase();

// OT: hours between 12am-8am count as OT
// OT rules (BACKEND ONLY — never surfaced/explained to users):
//   (1) Any time worked between 12:00 AM and 8:00 AM = overtime
//   (2) Any time worked beyond the 10th cumulative hour of a shift = overtime
// A minute counts as OT if it satisfies EITHER rule (union, no double-count).
const OT_THRESHOLD_HOURS = 10;
const OT_NIGHT_START = 0;  // 12:00 AM
const OT_NIGHT_END = 8;    // 8:00 AM

function calcHours(inTs, outTs, manualAdjustHours) {
  // Manual override: we only know the total, not the time-of-day distribution,
  // so only the 10-hour rule can apply. (Preserves manual adjustment logic.)
  if (typeof manualAdjustHours === "number" && manualAdjustHours >= 0) {
    const total = manualAdjustHours;
    const ot = Math.max(0, total - OT_THRESHOLD_HOURS);
    const regular = total - ot;
    return { regular, ot, total, adjusted: true };
  }
  if (!inTs) return { regular:0, ot:0, total:0, adjusted:false };
  const start = new Date(inTs);
  const end = outTs ? new Date(outTs) : new Date();
  if (end - start <= 0) return { regular:0, ot:0, total:0, adjusted:false };

  // Walk minute-by-minute; flag each minute OT if night-window OR past 10h cumulative.
  let regularMin = 0, otMin = 0, elapsedMin = 0;
  let cur = new Date(start);
  while (cur < end) {
    const next = new Date(Math.min(cur.getTime() + 60000, end.getTime()));
    const span = (next - cur) / 60000;
    const h = cur.getHours();
    const inNight = h >= OT_NIGHT_START && h < OT_NIGHT_END;
    const pastTen = elapsedMin >= OT_THRESHOLD_HOURS * 60;
    if (inNight || pastTen) otMin += span; else regularMin += span;
    elapsedMin += span;
    cur = next;
  }
  return { regular: regularMin/60, ot: otMin/60, total: (regularMin+otMin)/60, adjusted:false };
}

function fmtHours(h) {
  if (h===0) return "0h 0m";
  const hrs = Math.floor(h);
  const mins = Math.round((h-hrs)*60);
  return `${hrs}h ${mins}m`;
}

function shiftScheduledHours(shift) {
  const start = parseShiftStart(shift.date, shift.callTime);
  const end = start ? getShiftEnd(start, shift.endTime) : null;
  return (start && end) ? Math.round(((end - start) / 3600000) * 100) / 100 : null;
}

// ─── ACTIVE TIMELINE HELPERS ─────────────────────────────────────────────────
// Returns 0-1 representing where 'now' falls in the shift's window
function shiftProgress(shift, now = new Date()) {
  const start = parseShiftStart(shift.date, shift.callTime);
  const end = start ? getShiftEnd(start, shift.endTime) : null;
  if (!start || !end) return null;
  if (now < start) return { state:"before", pct:0, start, end, now };
  if (now > end) return { state:"after", pct:1, start, end, now };
  const total = end - start;
  const elapsed = now - start;
  return { state:"during", pct: Math.max(0, Math.min(1, elapsed/total)), start, end, now };
}

// ─── SHIFT STATUS PIPELINE ───────────────────────────────────────────────────
// Draft → Open → Crew Assigned → Awaiting Confirmation → Confirmed → In Progress
//   → Completed → Paid → Archived
const STATUS_ORDER = ["draft","open","assigned","awaiting","confirmed","in_progress","completed","paid","archived"];
const STATUS_META = {
  draft:       {label:"Draft",             short:"DRAFT",      color:"#71717a", bg:"rgba(113,113,122,0.15)"},
  open:        {label:"Open",              short:"OPEN",       color:"#4D9FFF", bg:"rgba(77,159,255,0.12)"},
  assigned:    {label:"Crew Assigned",     short:"ASSIGNED",   color:"#A78BFA", bg:"rgba(167,139,250,0.12)"},
  awaiting:    {label:"Awaiting Confirm",  short:"AWAITING",   color:"#E8C84A", bg:"rgba(232,200,74,0.12)"},
  confirmed:   {label:"Confirmed",         short:"CONFIRMED",  color:"#3ECF8E", bg:"rgba(62,207,142,0.12)"},
  in_progress: {label:"In Progress",       short:"LIVE",       color:"#E8C84A", bg:"rgba(232,200,74,0.18)"},
  completed:   {label:"Completed",         short:"DONE",       color:"#3ECF8E", bg:"rgba(62,207,142,0.10)"},
  paid:        {label:"Paid",              short:"PAID",       color:"#22c55e", bg:"rgba(34,197,94,0.14)"},
  archived:    {label:"Archived",          short:"ARCHIVED",   color:"#52525b", bg:"rgba(82,82,91,0.15)"},
};

// Auto-derive a shift's pipeline status from its data + the clock.
// Manual terminal states (draft / paid / archived) take priority when set.
function deriveShiftStatus(shift, now = new Date()) {
  if (shift.pipelineStatus === "archived") return "archived";
  if (shift.pipelineStatus === "paid") return "paid";
  if (shift.pipelineStatus === "draft") return "draft";

  const assigned = shift.crew?.filter(c => !c.declined).length || 0;
  const confirmed = shift.crew?.filter(c => c.confirmed && !c.declined).length || 0;
  const required = shift.requiredPositions || assigned || 0;

  const start = parseShiftStart(shift.date, shift.callTime);
  const end = start ? getShiftEnd(start, shift.endTime) : null;

  if (end && now > end) return "completed";
  if (start && end && now >= start && now <= end) return "in_progress";

  if (assigned === 0) return "open";
  if (required > assigned) return "open";       // still has unfilled positions
  if (confirmed === 0) return "assigned";
  if (confirmed < assigned) return "awaiting";
  return "confirmed";
}

// Position fill counts → { required, assigned, confirmed, declined, open }
function fillCounts(shift) {
  const assigned = shift.crew?.filter(c => !c.declined).length || 0;
  const confirmed = shift.crew?.filter(c => c.confirmed && !c.declined).length || 0;
  const declined = shift.crew?.filter(c => c.declined).length || 0;
  const required = shift.requiredPositions || assigned || 0;
  const open = Math.max(0, required - assigned);
  return { required, assigned, confirmed, declined, open };
}

// Small status pill component
function StatusBadge({status, size="md"}) {
  const m = STATUS_META[status] || STATUS_META.open;
  const live = status === "in_progress";
  return (
    <span style={{
      display:"inline-flex",alignItems:"center",gap:"4px",
      padding: size==="sm" ? "2px 7px" : "3px 9px",
      borderRadius:"5px",
      background:m.bg, color:m.color,
      border:`1px solid ${m.color}`,
      fontSize: size==="sm" ? "8px" : "9px",
      fontWeight:"700", letterSpacing:"0.08em", whiteSpace:"nowrap",
    }}>
      {live && <span style={{width:"5px",height:"5px",borderRadius:"50%",background:m.color,animation:"pulse 1.5s infinite"}}/>}
      {m.short}
    </span>
  );
}

// "4 / 6 Filled" pill
function FillBadge({shift, size="md"}) {
  const f = fillCounts(shift);
  const full = f.open === 0;
  const color = full ? "#3ECF8E" : f.assigned === 0 ? "#71717a" : "#E8C84A";
  return (
    <span style={{
      display:"inline-flex",alignItems:"center",gap:"4px",
      padding: size==="sm" ? "2px 7px" : "3px 9px",
      borderRadius:"5px",
      background: full ? "rgba(62,207,142,0.12)" : "rgba(232,200,74,0.10)",
      color, border:`1px solid ${color}`,
      fontSize: size==="sm" ? "8px" : "9px", fontWeight:"700", letterSpacing:"0.06em", whiteSpace:"nowrap",
    }}>
      {f.assigned}/{f.required} FILLED{f.open>0?` · ${f.open} OPEN`:""}
    </span>
  );
}

// ─── CONFLICT DETECTION ──────────────────────────────────────────────────────
// Given a roster member + a target shift window, return any scheduling conflicts.
// Checks: marked unavailable that day · already assigned to an overlapping shift.
function detectConflicts(rosterId, targetDateStr, targetCallTime, targetEndTime, allShifts, availability, excludeShiftId) {
  const conflicts = [];
  const start = parseShiftStart(targetDateStr, targetCallTime);
  const end = start ? getShiftEnd(start, targetEndTime) : null;

  // 1) Availability check — was this date marked unavailable / tentative?
  if (start) {
    const y = start.getFullYear();
    const m = String(start.getMonth()+1).padStart(2,"0");
    const d = String(start.getDate()).padStart(2,"0");
    const key = `${y}-${m}-${d}`;
    const avail = (availability?.[rosterId] || {})[key];
    const availState = avail && typeof avail === "object" ? avail.state : avail;
    if (availState === "unavailable") conflicts.push({type:"unavailable", severity:"high", text:"Marked unavailable this day"});
    else if (availState === "tentative") conflicts.push({type:"tentative", severity:"low", text:"Marked tentative this day"});
  }

  // 2) Double-booking — overlapping shift the member is already on
  if (start && end) {
    for (const s of allShifts) {
      if (s.id === excludeShiftId) continue;
      if (!s.crew?.some(c => c.rosterId === rosterId && !c.declined)) continue;
      const sStart = parseShiftStart(s.date, s.callTime);
      const sEnd = sStart ? getShiftEnd(sStart, s.endTime) : null;
      if (!sStart || !sEnd) continue;
      // overlap if start < other end AND end > other start
      if (start < sEnd && end > sStart) {
        conflicts.push({type:"overlap", severity:"high", text:`Already on "${s.client}" (${s.date})`});
      }
    }
  }
  return conflicts;
}

// ─── CREW STATS (for roster database + profiles) ─────────────────────────────
// Derived from shift history — no extra fields needed.
function crewStats(rosterId, shifts) {
  let assigned = 0, confirmed = 0, declined = 0, completed = 0, totalHours = 0, otHours = 0;
  const history = [];
  shifts.forEach(s => {
    const c = s.crew?.find(x => x.rosterId === rosterId);
    if (!c) return;
    assigned++;
    if (c.confirmed) confirmed++;
    if (c.declined) declined++;
    const h = calcHours(c.clockIn, c.clockOut, c.manualHours);
    if (h.total > 0) { completed++; totalHours += h.total; otHours += h.ot; }
    history.push({shiftId:s.id, client:s.client, date:s.date, confirmed:c.confirmed, declined:c.declined, hours:h.total});
  });
  const confirmRate = assigned > 0 ? Math.round((confirmed / assigned) * 100) : null;
  return { assigned, confirmed, declined, completed, totalHours, otHours, confirmRate, history };
}

// ─── SHIFT DATE/TIME PARSING ─────────────────────────────────────────────────
// Parse "MM/DD/YYYY" + "3:00 PM" → JS Date
function parseShiftStart(dateStr, timeStr) {
  try {
    const parts = dateStr.split("/").map(Number);
    if(parts.length<3) return null;
    const [m,d,y] = parts;
    const tm = timeStr.match(/(\d{1,2}):?(\d{0,2})\s*(AM|PM)?/i);
    if(!tm) return null;
    let h = parseInt(tm[1]); const mn = parseInt(tm[2]||"0");
    const ampm = (tm[3]||"").toUpperCase();
    if(ampm==="PM" && h<12) h+=12;
    if(ampm==="AM" && h===12) h=0;
    return new Date(y, m-1, d, h, mn);
  } catch { return null; }
}

// Given start date + end time string, compute end Date (handles midnight rollover)
function getShiftEnd(startDate, endTimeStr) {
  if(!startDate || !endTimeStr) return null;
  const tm = endTimeStr.match(/(\d{1,2}):?(\d{0,2})\s*(AM|PM)?/i);
  if(!tm) return null;
  let h = parseInt(tm[1]); const mn = parseInt(tm[2]||"0");
  const ampm = (tm[3]||"").toUpperCase();
  if(ampm==="PM" && h<12) h+=12;
  if(ampm==="AM" && h===12) h=0;
  const end = new Date(startDate);
  end.setHours(h, mn, 0, 0);
  if(end <= startDate) end.setDate(end.getDate()+1); // rolled past midnight
  return end;
}

// Pad with leading 0
const pad2 = n => String(n).padStart(2,"0");

// Format date for ICS (local time, no Z): YYYYMMDDTHHMMSS
function icsDate(d) {
  return `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}T${pad2(d.getHours())}${pad2(d.getMinutes())}00`;
}

// Generate .ics calendar file for a shift
function generateICS(shift) {
  const start = parseShiftStart(shift.date, shift.callTime);
  const end = start ? getShiftEnd(start, shift.endTime) : null;
  if(!start || !end) return null;
  const dtStamp = icsDate(new Date());
  const dtStart = icsDate(start);
  const dtEnd = icsDate(end);
  const summary = `BigCrew NYC – ${shift.client} @ ${shift.location}`;
  // RFC 5545 escaping: backslash, comma, semicolon, newline
  const escICS = s => (s||"").replace(/\\/g,"\\\\").replace(/[,;]/g, m=>"\\"+m).replace(/\r?\n/g,"\\n");
  const desc = [
    shift.notes,
    "",
    `Client: ${shift.client}`,
    `Location: ${shift.location}`,
    `POC: ${shift.poc}${shift.pocPhone?" ("+shift.pocPhone+")":""}`,
    "",
    "Scope:",
    ...shift.scope.map(s=>"• "+s),
    "",
    "Uniform:",
    shift.uniform,
  ].join("\n");
  // RFC 5545 requires CRLF line endings
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BigCrew NYC//Shift Manager//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${shift.id}@bigcrewnyc.com`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escICS(summary)}`,
    `LOCATION:${escICS(shift.address)}`,
    `DESCRIPTION:${escICS(desc)}`,
    "STATUS:CONFIRMED",
    "BEGIN:VALARM",
    "TRIGGER:-PT1H",
    "ACTION:DISPLAY",
    "DESCRIPTION:BigCrew shift in 1 hour",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

function downloadICS(shift) {
  const ics = generateICS(shift);
  if(!ics) { alert("Cannot create calendar event – check shift date/time format (e.g. 05/31/2026, 3:00 PM)"); return false; }
  try {
    const blob = new Blob([ics], {type:"text/calendar;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `BigCrew-${shift.client.replace(/[^a-z0-9]/gi,"_")}-${shift.date.replace(/\//g,"-")}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
    return true;
  } catch(e) { console.error("ICS download failed:", e); return false; }
}

// Google Calendar template URL — opens pre-filled event in google calendar, no API key required
function googleCalendarUrl(shift) {
  const start = parseShiftStart(shift.date, shift.callTime);
  const end = start ? getShiftEnd(start, shift.endTime) : null;
  if(!start || !end) return null;
  const f = d => `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}T${pad2(d.getHours())}${pad2(d.getMinutes())}00`;
  const details = [
    shift.notes,
    "",
    `Client: ${shift.client}`,
    `POC: ${shift.poc}${shift.pocPhone?" ("+shift.pocPhone+")":""}`,
    "",
    "Scope:",
    ...shift.scope.map(s=>"• "+s),
    "",
    "Uniform:",
    shift.uniform,
  ].join("\n");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `BigCrew – ${shift.client}`,
    dates: `${f(start)}/${f(end)}`,
    details: details,
    location: shift.address || "",
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

// Outlook web template URL (works for outlook.com / m365)
function outlookCalendarUrl(shift) {
  const start = parseShiftStart(shift.date, shift.callTime);
  const end = start ? getShiftEnd(start, shift.endTime) : null;
  if(!start || !end) return null;
  const iso = d => d.toISOString();
  const details = `${shift.notes}\n\nClient: ${shift.client}\nPOC: ${shift.poc}\n\nScope:\n${shift.scope.map(s=>"• "+s).join("\n")}\n\nUniform: ${shift.uniform}`;
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    startdt: iso(start),
    enddt: iso(end),
    subject: `BigCrew – ${shift.client}`,
    location: shift.address || "",
    body: details,
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params}`;
}

// ─── TIME CONVERSION (display ↔ 24-hour) ─────────────────────────────────────
// "3:00 PM" → "15:00"  for HTML5 <input type="time">
function to24Hour(displayTime) {
  if(!displayTime) return "";
  const m = displayTime.match(/(\d{1,2}):?(\d{0,2})\s*(AM|PM)?/i);
  if(!m) return "";
  let h = parseInt(m[1]);
  const mn = (m[2] || "0").padStart(2,"0");
  const ampm = (m[3]||"").toUpperCase();
  if(ampm==="PM" && h<12) h+=12;
  if(ampm==="AM" && h===12) h=0;
  return `${pad2(h)}:${mn}`;
}
// "15:00" → "3:00 PM"
function from24Hour(time24) {
  if(!time24) return "";
  const m = time24.match(/(\d{1,2}):(\d{2})/);
  if(!m) return time24;
  let h = parseInt(m[1]);
  const mn = m[2];
  const ampm = h>=12 ? "PM" : "AM";
  const h12 = h===0 ? 12 : (h>12 ? h-12 : h);
  return `${h12}:${mn} ${ampm}`;
}

// ─── WEEK HELPERS ────────────────────────────────────────────────────────────
// Get Monday of a given date's week
function getWeekStart(d) {
  const date = new Date(d);
  const day = date.getDay(); // 0=Sun, 1=Mon...
  const diff = day===0 ? -6 : 1-day; // Sunday → -6, Mon→0
  date.setDate(date.getDate() + diff);
  date.setHours(0,0,0,0);
  return date;
}

function fmtHour12(h) {
  const hh = h % 24;
  if (hh === 0) return "12 AM";
  if (hh === 12) return "12 PM";
  if (hh < 12) return `${hh} AM`;
  return `${hh-12} PM`;
}

// ─── GOOGLE CALENDAR PASTE PARSER ────────────────────────────────────────────
// Accepts either a Google Calendar URL (calendar.google.com/event?...) or raw event text
// and returns a shift-form-compatible object.

// ─── SHIFT BRIEF PASTE PARSER ────────────────────────────────────────────────
// Parses the group-text-style shift brief managers already write by hand:
//   Date: / Call Time: / Location: / Client: / On site contact: / Uniform: /
//   Tools & PPE: / Goals/Scope/Notes: / CREW (numbered list, sub-headed roles)
// Labels may carry their value inline or on the following line(s). Crew names
// are fuzzy-matched to the roster (exact → first+last-initial → unique first).
function parseShiftBrief(text, roster) {
  if (!text || !text.trim()) return null;
  const rawLines = text.split(/\r?\n/).map(l => l.trim());

  const LABELS = [
    { key: "date",     re: /^date\s*:?\s*(.*)$/i },
    { key: "callTime", re: /^call\s*time\s*:?\s*(.*)$/i },
    { key: "location", re: /^(?:location|where|venue|address)\s*:?\s*(.*)$/i },
    { key: "client",   re: /^client\s*:?\s*(.*)$/i },
    { key: "poc",      re: /^(?:on\s*-?\s*site\s*contact|poc|contact|point\s*of\s*contact)\s*:?\s*(.*)$/i },
    { key: "uniform",  re: /^(?:uniform|dress\s*code)\s*:?\s*(.*)$/i },
    { key: "tools",    re: /^tools\s*(?:&|and|\/)?\s*(?:ppe)?\s*:?\s*(.*)$/i },
    { key: "scope",    re: /^(?:goals?|scope|notes?)(?:\s*[\/&]\s*(?:goals?|scope|notes?))*\s*:?\s*(.*)$/i },
    { key: "crew",     re: /^crew\b\s*:?\s*(.*)$/i },
  ];
  const matchLabel = (line) => {
    for (const l of LABELS) { const m = line.match(l.re); if (m) return { key: l.key, inline: (m[1] || "").trim() }; }
    return null;
  };

  const fields = {}; const scopeLines = []; const crewNames = []; const footer = [];
  let section = null;   // which multi-line field we're inside
  let crewTag = null;   // current sub-heading role tag inside CREW ("Fork ops")

  for (const line of rawLines) {
    if (!line) { continue; }
    const label = matchLabel(line);
    if (label) {
      section = label.key; crewTag = null;
      if (label.inline) {
        if (section === "scope") scopeLines.push(label.inline);
        else if (section !== "crew") { fields[section] = label.inline; section = null; }
      }
      continue;
    }
    if (section === "crew") {
      const numbered = line.match(/^\d+\s*[\.\)\-]?\s*(.+)$/);
      if (numbered) {
        let name = numbered[1].trim();
        let tag = crewTag;
        const cc = name.match(/\((CC|LEAD|CAPTAIN)\)/i);
        if (cc) { tag = "CC"; name = name.replace(/\s*\((CC|LEAD|CAPTAIN)\)\s*/i, " ").trim(); }
        if (name) crewNames.push({ name, roleTag: tag });
      } else if (/^please|^professionalism|^lateness|^thank/i.test(line)) {
        section = "footer"; footer.push(line);
      } else if (line.length <= 24 && line.split(/\s+/).length <= 3 && !/[.!?]$/.test(line)) {
        // Sub-heading like "Fork ops" — short, few words, no sentence
        // punctuation. Longer stray lines are ignored rather than becoming
        // garbage role tags on the crew that follows.
        crewTag = line.replace(/:$/, "").trim();
      }
      continue;
    }
    if (section === "footer") { footer.push(line); continue; }
    if (section === "scope") { scopeLines.push(line); continue; }
    if (section && !fields[section]) { fields[section] = line; section = null; continue; }
    // Unclaimed text before any label ("PLEASE CONFIRM!") or between sections
    if (/^please|^professionalism|^lateness|^thank/i.test(line)) footer.push(line);
  }

  // Date "06/28/26" → input format YYYY-MM-DD
  let date = "";
  const dm = (fields.date || "").match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (dm) {
    const y = dm[3].length === 2 ? "20" + dm[3] : dm[3];
    date = `${y}-${dm[1].padStart(2, "0")}-${dm[2].padStart(2, "0")}`;
  }

  // "11pm - 8am" → "11:00 PM" / "8:00 AM" (TimeInput display format)
  const parseOneTime = (s) => {
    const m = (s || "").match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (!m) return "";
    let h = parseInt(m[1]); const mn = m[2] || "00";
    let ap = (m[3] || "").toUpperCase();
    if (!ap) ap = h >= 12 ? "PM" : "AM";
    if (h > 12) { h -= 12; ap = "PM"; }
    if (h === 0) { h = 12; ap = "AM"; }
    return `${h}:${mn} ${ap}`;
  };
  const timeParts = (fields.callTime || "").split(/\s*(?:-|–|—|to)\s*/i);
  const callTime = parseOneTime(timeParts[0]);
  const endTime = timeParts[1] ? parseOneTime(timeParts[1]) : "";

  // Fuzzy roster match: exact → first name + last initial → unique first name
  const active = (roster || []).filter(r => r.active !== false);
  const matchRoster = (name) => {
    const n = name.toLowerCase().replace(/\s+/g, " ").trim();
    let m = active.find(r => r.name.toLowerCase().trim() === n);
    if (m) return m;
    const parts = n.split(" ");
    const first = parts[0]; const lastInit = parts.length > 1 ? parts[parts.length - 1][0] : null;
    if (lastInit) {
      m = active.find(r => {
        const rp = r.name.toLowerCase().split(/\s+/);
        return rp[0] === first && rp.length > 1 && rp[rp.length - 1][0] === lastInit;
      });
      if (m) return m;
    }
    const firsts = active.filter(r => r.name.toLowerCase().split(/\s+/)[0] === first);
    return firsts.length === 1 ? firsts[0] : null;
  };

  const matched = []; const unmatched = [];
  crewNames.forEach(c => {
    const r = matchRoster(c.name);
    if (r && !matched.find(x => x.rosterId === r.id)) matched.push({ rosterId: r.id, roleTag: c.roleTag, name: r.name, phone: r.phone || "" });
    else if (!r && !unmatched.find(x => x.name.toLowerCase() === c.name.toLowerCase())) unmatched.push(c);
  });

  const notes = [
    fields.tools ? `Tools & PPE: ${fields.tools}` : null,
    footer.length ? footer.join(" ") : null,
  ].filter(Boolean).join("\n");

  const address = (fields.location || "").match(/\d{5}|\d+\s+\w+/) ? fields.location : "";
  return {
    form: {
      client: fields.client || "",
      date, callTime, endTime,
      location: (fields.location || "").split(",")[0].trim(),
      address,
      poc: fields.poc || "",
      uniform: fields.uniform || "",
      notes,
    },
    scope: scopeLines,
    matched, unmatched,
  };
}

// ─── AVAILABILITY TEXT PARSER ────────────────────────────────────────────────
// Parses messages like:
//   "Available tomorrow 8am - 5pm"
//   "I have 8am-8pm tomorrow"
//   "7pm-12am Monday"
//   "I got jobs the 23rd 24th 25th 26th 27th 29th 30th 31st 2nd 3rd 4th 5th 6th"
// Returns an array of { date: "YYYY-MM-DD", state: "available"|"unavailable", start?: "3:00 PM", end?: "5:00 PM" }
function parseAvailabilityText(input, baseDate = new Date()) {
  if (!input || !input.trim()) return [];
  const results = [];
  const txt = input.toLowerCase();
  const base = new Date(baseDate);
  base.setHours(0,0,0,0);

  // Determine "unavailable" intent: "i got jobs", "busy", "not available", "unavailable", "off"
  const unavailableIntent = /\bi\s+got\s+jobs?\b|\bbusy\b|\bnot\s+available\b|\bunavailable\b|\boff\b|\bcan'?t\s+work\b|\bworking\b/.test(txt);

  // Determine "available" intent
  const availableIntent = /\bavailable\b|\bfree\b|\bopen\b|\bi\s+have\b|\bcan\s+work\b/.test(txt);

  const intent = unavailableIntent ? "unavailable" : "available";

  // 1) Day-name patterns: "Monday", "tomorrow", "today"
  const dayNames = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
  const dayMatches = [];

  // "today"
  if (/\btoday\b/.test(txt)) {
    const d = new Date(base);
    dayMatches.push({date:d, label:"today"});
  }
  // "tomorrow"
  if (/\btomorrow\b/.test(txt)) {
    const d = new Date(base);
    d.setDate(d.getDate()+1);
    dayMatches.push({date:d, label:"tomorrow"});
  }
  // Day names — next occurrence of that day
  for (const dn of dayNames) {
    const re = new RegExp(`\\b${dn}\\b`, "g");
    const matches = [...txt.matchAll(re)];
    if (matches.length > 0) {
      const targetDow = dayNames.indexOf(dn);
      const today = base.getDay();
      let diff = targetDow - today;
      if (diff <= 0) diff += 7;
      const d = new Date(base);
      d.setDate(d.getDate()+diff);
      dayMatches.push({date:d, label:dn});
    }
  }

  // 2) Date-number patterns: "23rd 24th 25th" — interpret as days of current/next month
  const dayNumMatches = [...txt.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)\b/g)].map(m => parseInt(m[1]));

  if (dayNumMatches.length > 0) {
    const currentMonth = base.getMonth();
    const currentYear = base.getFullYear();
    const todayDate = base.getDate();
    let lastDay = -1;
    let monthOffset = 0;
    for (const day of dayNumMatches) {
      // If day < last day seen, roll to next month
      if (day < lastDay) monthOffset++;
      lastDay = day;
      // If day is in the past for current month, push to next month
      const useMonth = currentMonth + monthOffset;
      const useDate = new Date(currentYear, useMonth, day);
      if (monthOffset === 0 && day < todayDate) {
        useDate.setMonth(useDate.getMonth() + 1);
      }
      dayMatches.push({date:useDate, label:`${day}${ordinal(day)}`});
    }
  }

  // 3) Time range
  let timeStart = null, timeEnd = null;
  const timeRange = txt.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|to|–|—|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (timeRange) {
    const [, h1, m1, ap1, h2, m2, ap2] = timeRange;
    const toDisp = (h, m, ap) => {
      let hh = parseInt(h);
      const mm = m || "00";
      let suf = (ap || "").toUpperCase();
      if (!suf) suf = hh >= 12 ? "PM" : "AM";
      if (hh > 12) { hh -= 12; suf = "PM"; }
      if (hh === 0) { hh = 12; suf = "AM"; }
      return `${hh}:${mm} ${suf}`;
    };
    timeStart = toDisp(h1, m1, ap1);
    timeEnd = toDisp(h2, m2, ap2);
  }

  // Build the result entries
  for (const dm of dayMatches) {
    const y = dm.date.getFullYear();
    const m = String(dm.date.getMonth()+1).padStart(2,"0");
    const d = String(dm.date.getDate()).padStart(2,"0");
    const dateStr = `${y}-${m}-${d}`;
    // Avoid duplicates
    if (results.find(r => r.date === dateStr)) continue;
    results.push({
      date: dateStr,
      state: intent,
      start: timeStart,
      end: timeEnd,
      label: dm.label,
    });
  }

  return results;
}

function ordinal(n) {
  const s = ["th","st","nd","rd"], v = n%100;
  return s[(v-20)%10] || s[v] || s[0];
}

// ─── NY / NYC / FEDERAL / SE TAX CALCULATOR ──────────────────────────────────
// IMPORTANT: These brackets are based on 2024 tax year (most recent fully-published).
// 2025 and 2026 brackets are inflation-adjusted annually by the IRS, NY, and NYC.
// VERIFY at irs.gov, tax.ny.gov, and nyc.gov/finance before relying on these for filing.
// Single-filer brackets only. For married/HoH, calculations differ significantly.

const TAX_DATA_YEAR = 2024;

// Federal single-filer brackets 2024
const FED_BRACKETS_SINGLE_2024 = [
  [11600, 0.10],
  [47150, 0.12],
  [100525, 0.22],
  [191950, 0.24],
  [243725, 0.32],
  [609350, 0.35],
  [Infinity, 0.37],
];
const FED_STD_DEDUCTION_SINGLE_2024 = 14600;

// NY State single-filer brackets 2024 (approximate)
const NY_STATE_BRACKETS_SINGLE_2024 = [
  [8500, 0.04],
  [11700, 0.045],
  [13900, 0.0525],
  [80650, 0.055],
  [215400, 0.06],
  [1077550, 0.0685],
  [5000000, 0.0965],
  [25000000, 0.103],
  [Infinity, 0.109],
];

// NYC resident single-filer brackets 2024 (approximate)
const NYC_BRACKETS_SINGLE_2024 = [
  [12000, 0.03078],
  [25000, 0.03762],
  [50000, 0.03819],
  [Infinity, 0.03876],
];

// Self-employment tax: 12.4% Social Security up to wage base + 2.9% Medicare on all
const SE_SS_RATE = 0.124;
const SE_MEDICARE_RATE = 0.029;
const SE_WAGE_BASE_2024 = 168600;
const SE_NET_ADJUSTMENT = 0.9235; // 92.35% — accounts for half of SE tax as expense

function calcTaxBracket(income, brackets) {
  if (income <= 0) return 0;
  let tax = 0;
  let prevLimit = 0;
  for (const [limit, rate] of brackets) {
    if (income <= limit) {
      tax += (income - prevLimit) * rate;
      return tax;
    }
    tax += (limit - prevLimit) * rate;
    prevLimit = limit;
  }
  return tax;
}

function calcSETax(netSE) {
  if (netSE <= 0) return { ss:0, medicare:0, total:0, halfDeductible:0 };
  const taxable = netSE * SE_NET_ADJUSTMENT;
  const ss = Math.min(taxable, SE_WAGE_BASE_2024) * SE_SS_RATE;
  const medicare = taxable * SE_MEDICARE_RATE;
  const total = ss + medicare;
  return { ss, medicare, total, halfDeductible: total / 2 };
}

// Comprehensive NYC 1099 tax estimate (single filer)
function calcNYCTax(grossIncome, businessExpenses, mileageDeduction) {
  const netSelfEmployment = Math.max(0, grossIncome - businessExpenses - mileageDeduction);
  const seTax = calcSETax(netSelfEmployment);
  // Half of SE tax is deductible as adjustment to income
  const adjustedIncome = netSelfEmployment - seTax.halfDeductible;
  // Subtract standard deduction for federal
  const fedTaxable = Math.max(0, adjustedIncome - FED_STD_DEDUCTION_SINGLE_2024);
  const federal = calcTaxBracket(fedTaxable, FED_BRACKETS_SINGLE_2024);
  // NY state taxable income — NY uses federal AGI as starting point, similar standard deduction
  // 2024 NY single standard deduction was approximately $8,000
  const nyStdDeduction = 8000;
  const nyTaxable = Math.max(0, adjustedIncome - nyStdDeduction);
  const nyState = calcTaxBracket(nyTaxable, NY_STATE_BRACKETS_SINGLE_2024);
  // NYC tax — same starting point, no separate standard deduction in NYC
  const nyc = calcTaxBracket(nyTaxable, NYC_BRACKETS_SINGLE_2024);
  const totalTax = seTax.total + federal + nyState + nyc;
  const effectiveRate = grossIncome > 0 ? totalTax / grossIncome : 0;
  return {
    grossIncome,
    businessExpenses,
    mileageDeduction,
    netSelfEmployment,
    seTax: seTax.total,
    seTaxSS: seTax.ss,
    seTaxMedicare: seTax.medicare,
    seTaxHalfDeductible: seTax.halfDeductible,
    adjustedIncome,
    fedTaxable,
    federal,
    nyTaxable,
    nyState,
    nyc,
    totalTax,
    afterTax: grossIncome - totalTax,
    effectiveRate,
  };
}

// Build a styled HTML report for printing (print → save as PDF)
function buildPrintableReport(year, yt, tax, allEntries, currentUser) {
  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const yearEntries = allEntries.filter(e => new Date(e.date+"T12:00:00").getFullYear() === year);
  const userName = currentUser?.name || "1099 Contractor";

  let html = `<!DOCTYPE html><html><head>
    <meta charset="utf-8">
    <title>${year} Tax Report - ${userName}</title>
    <style>
      @page { margin: 0.6in; }
      body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #111; line-height: 1.5; font-size: 11pt; }
      h1 { font-size: 24pt; margin: 0 0 6pt; letter-spacing: 0.04em; }
      h2 { font-size: 14pt; margin: 18pt 0 8pt; padding-bottom: 4pt; border-bottom: 2px solid #333; }
      .meta { font-size: 9pt; color: #666; margin-bottom: 24pt; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10pt; margin-bottom: 16pt; }
      .stat { background: #f5f5f5; padding: 10pt; border-radius: 4pt; }
      .stat .label { font-size: 8pt; color: #666; letter-spacing: 0.08em; text-transform: uppercase; }
      .stat .value { font-size: 16pt; font-weight: 700; margin-top: 3pt; }
      table { width: 100%; border-collapse: collapse; font-size: 10pt; margin-bottom: 12pt; }
      th { text-align: left; background: #e8e8e8; padding: 5pt 8pt; font-size: 9pt; }
      td { padding: 5pt 8pt; border-bottom: 1px solid #ddd; }
      .right { text-align: right; }
      .total { font-weight: 700; background: #f0f0f0; }
      .breakdown { background: #fff8e1; border: 1px solid #ffb74d; padding: 12pt; border-radius: 4pt; margin: 12pt 0; }
      .breakdown .row { display: flex; justify-content: space-between; padding: 3pt 0; font-size: 10pt; }
      .breakdown .section { margin-bottom: 8pt; padding-bottom: 6pt; border-bottom: 1px solid #ffcc80; }
      .breakdown .section:last-child { border-bottom: none; }
      .footer { margin-top: 32pt; font-size: 8pt; color: #666; line-height: 1.6; padding-top: 12pt; border-top: 1px solid #ccc; }
      .green { color: #2e7d32; }
      .red { color: #c62828; }
      .orange { color: #ef6c00; }
    </style>
  </head><body>
    <h1>${year} Tax Report</h1>
    <div class="meta">${userName} · 1099-NEC Independent Contractor · New York, NY · Generated ${new Date().toLocaleString()}</div>

    <h2>Income Summary</h2>
    <div class="grid">
      <div class="stat"><div class="label">Gross Income</div><div class="value green">$${yt.totalPaid.toFixed(2)}</div></div>
      <div class="stat"><div class="label">Total Expenses</div><div class="value red">$${yt.totalExp.toFixed(2)}</div></div>
      <div class="stat"><div class="label">Mileage Deduction (${yt.totalMiles} mi)</div><div class="value">$${yt.mileageDed.toFixed(2)}</div></div>
      <div class="stat"><div class="label">Net (Taxable Income)</div><div class="value orange">$${yt.taxableIncome.toFixed(2)}</div></div>
    </div>`;

  if (tax) {
    html += `
    <h2>Estimated Tax Liability (NYC)</h2>
    <div class="breakdown">
      <div class="section">
        <div class="row"><strong>Self-Employment Tax</strong><strong>$${tax.seTax.toFixed(2)}</strong></div>
        <div class="row"><span style="color:#666;padding-left:12pt;">— Social Security (12.4%)</span><span>$${tax.seTaxSS.toFixed(2)}</span></div>
        <div class="row"><span style="color:#666;padding-left:12pt;">— Medicare (2.9%)</span><span>$${tax.seTaxMedicare.toFixed(2)}</span></div>
      </div>
      <div class="section">
        <div class="row"><strong>Income Tax</strong><strong>$${(tax.federal + tax.nyState + tax.nyc).toFixed(2)}</strong></div>
        <div class="row"><span style="color:#666;padding-left:12pt;">— Federal</span><span>$${tax.federal.toFixed(2)}</span></div>
        <div class="row"><span style="color:#666;padding-left:12pt;">— New York State</span><span>$${tax.nyState.toFixed(2)}</span></div>
        <div class="row"><span style="color:#666;padding-left:12pt;">— NYC Resident Tax</span><span>$${tax.nyc.toFixed(2)}</span></div>
      </div>
      <div style="font-size:13pt;font-weight:700;display:flex;justify-content:space-between;padding-top:6pt;">
        <span>TOTAL ESTIMATED TAX</span>
        <span class="orange">$${tax.totalTax.toFixed(2)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:10pt;margin-top:4pt;">
        <span>Effective Rate</span>
        <span>${(tax.effectiveRate*100).toFixed(1)}%</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11pt;margin-top:8pt;padding-top:6pt;border-top:1px solid #ffcc80;">
        <strong>Take-home (after tax)</strong>
        <strong class="green">$${tax.afterTax.toFixed(2)}</strong>
      </div>
    </div>`;
  }

  // Month-by-month
  html += `<h2>Monthly Breakdown</h2><table>
    <thead><tr><th>Month</th><th class="right">Entries</th><th class="right">Paid</th><th class="right">Expenses</th><th class="right">Net</th></tr></thead>
    <tbody>`;
  let totalEntries = 0, totalPaid = 0, totalExp = 0, totalNet = 0;
  monthNames.forEach((mn, mi) => {
    const mEntries = yearEntries.filter(e => new Date(e.date+"T12:00:00").getMonth() === mi);
    if (mEntries.length === 0) return;
    const paid = mEntries.reduce((a,e)=>a+(e.paid||0),0);
    const exp = mEntries.reduce((a,e)=>a+(e.items?.reduce((b,x)=>b+(parseFloat(x)||0),0)||0),0);
    const net = paid - exp;
    totalEntries += mEntries.length; totalPaid += paid; totalExp += exp; totalNet += net;
    html += `<tr><td>${mn}</td><td class="right">${mEntries.length}</td><td class="right green">$${paid.toFixed(2)}</td><td class="right red">$${exp.toFixed(2)}</td><td class="right">$${net.toFixed(2)}</td></tr>`;
  });
  html += `<tr class="total"><td>TOTAL</td><td class="right">${totalEntries}</td><td class="right green">$${totalPaid.toFixed(2)}</td><td class="right red">$${totalExp.toFixed(2)}</td><td class="right">$${totalNet.toFixed(2)}</td></tr></tbody></table>`;

  // Detailed entries
  if (yearEntries.length > 0 && yearEntries.length <= 200) {
    html += `<h2>Entry Log</h2><table>
      <thead><tr><th>Date</th><th>Notes</th><th class="right">Receipts</th><th class="right">Paid</th><th class="right">Mileage</th></tr></thead>
      <tbody>`;
    const sorted = [...yearEntries].sort((a,b)=>a.date.localeCompare(b.date));
    sorted.forEach(e => {
      const exp = e.items?.reduce((a,x)=>a+(parseFloat(x)||0),0) || 0;
      html += `<tr><td>${e.date}</td><td>${(e.notes||"").replace(/[<>]/g,"")}</td><td class="right red">$${exp.toFixed(2)}</td><td class="right green">$${(e.paid||0).toFixed(2)}</td><td class="right">${e.mileage||0} mi</td></tr>`;
    });
    html += `</tbody></table>`;
  }

  html += `<div class="footer">
    <strong>Disclaimer:</strong> This is an estimate based on 2024 IRS, New York State, and NYC tax brackets for a single filer. Brackets change yearly and your actual liability may differ.
    Self-employment tax is calculated on 92.35% of net SE income (the SE adjustment), with 12.4% Social Security (capped at the $${SE_WAGE_BASE_2024.toLocaleString()} wage base) and 2.9% Medicare.
    Half of the SE tax is deductible against your federal AGI. <strong>Verify all numbers with a CPA before filing</strong>. IRS mileage rate used: $${IRS_MILEAGE_RATE}/mile.
    <br><br>Generated by BigCrew NYC App · ${new Date().toLocaleString()}
  </div>
  </body></html>`;
  return html;
}

// ─── DEFAULT DATA ────────────────────────────────────────────────────────────
// Real system starts with an empty roster — managers add crew through the app.
const DEFAULT_ROSTER = [];

// Role tags for crew on shifts (e.g. CC = Crew Captain, TECH = Technician, etc.)
const DEFAULT_ROLE_TAGS = [
  {code:"CC", label:"Crew Captain (Lead)", color:"#E8C84A"},
  {code:"TECH", label:"Technician", color:"#4D9FFF"},
  {code:"SH", label:"Stagehand", color:"#3ECF8E"},
  {code:"DRIVER", label:"Driver", color:"#A78BFA"},
  {code:"SL OP", label:"Scissor Lift Op", color:"#F97316"},
];

const INIT = {
  roster: DEFAULT_ROSTER,
  shifts: [],
  activeShiftId: null,
  notifications: [],
  // availability: { rosterId: { "2026-05-31": "available" | "unavailable" | "tentative" } }
  availability: {},
  // expenses: array of expense entries per user
  // { id, userId, userName, date:"YYYY-MM-DD", items:[22.28,11.86], paid:171, mileage:0, notes:"", ts }
  expenses: [],
  // Tombstones for roster deletions: [{userId, email, name, ts}] — checked at
  // login so deleted crew don't resurrect themselves via self-registration.
  removedIdentities: [],
  // Manager-added custom role tags beyond the defaults
  customRoleTags: [],
};

// ─── STYLES ──────────────────────────────────────────────────────────────────
const card = (extra={}) => ({background:C.s1,border:`2px solid ${C.border}`,borderRadius:"10px",padding:"14px",...extra});
const lbl = {fontSize:"10px",letterSpacing:"0.2em",color:C.dim,textTransform:"uppercase",marginBottom:"4px",display:"block",fontWeight:"700"};
const inp = {background:"var(--bc-inpbg)",border:`2px solid ${C.borderHi}`,borderRadius:"7px",padding:"10px 12px",fontSize:"14px",color:C.text,fontFamily:C.font,width:"100%",outline:"none",boxSizing:"border-box",fontWeight:"600"};
const btn = (v="gold",full=false) => ({
  padding:"11px 18px",borderRadius:"8px",fontSize:"11px",fontWeight:"800",letterSpacing:"0.12em",
  textTransform:"uppercase",cursor:"pointer",fontFamily:C.font,border:"none",width:full?"100%":"auto",
  background: v==="gold"?"#E8C84A":v==="green"?C.green:v==="red"?C.red:v==="blue"?C.blue:v==="purple"?C.purple:C.s3,
  color: v==="ghost"?C.muted:v==="default"?C.text:v==="gold"?"#1a1400":"var(--bc-onaccent)",
});
const badge = (color,bg) => ({background:bg,color,fontSize:"9px",letterSpacing:"0.12em",fontWeight:"800",textTransform:"uppercase",padding:"3px 8px",borderRadius:"4px",display:"inline-block",border:`1px solid ${color}22`});
const tabBtn = (active) => ({flex:1,padding:"10px 6px",textAlign:"center",fontSize:"10px",fontWeight:"800",letterSpacing:"0.1em",textTransform:"uppercase",cursor:"pointer",background:active?"#E8C84A":"transparent",color:active?"#1a1400":C.muted,border:"none",fontFamily:C.font,borderRadius:"5px",transition:"all 0.15s"});

// ── LOGO — real PNG mark ──────────────────────────────────────────────────────
function Logo({size=40}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/bigcrewlogo.png" alt="BigCrew" width={size} height={size} style={{objectFit:"contain",display:"block",filter:"var(--bc-logofilter)"}}/>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// REUSABLE COMPONENTS
// ══════════════════════════════════════════════════════════════════════════════

// Searchable name dropdown – type to filter from a name list
function SearchableNameDropdown({options, onSelect, placeholder="Type a name…", excludeIds=[], autoFocus=false, availabilityOf=null}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  useEffect(()=>{ if(autoFocus && inputRef.current) inputRef.current.focus(); },[autoFocus]);
  const filtered = options.filter(o =>
    !excludeIds.includes(o.id) &&
    o.name.toLowerCase().includes(q.toLowerCase())
  ).slice(0, 8);

  return (
    <div style={{position:"relative"}}>
      <input
        ref={inputRef}
        value={q}
        onChange={e=>{setQ(e.target.value); setOpen(true);}}
        onFocus={()=>setOpen(true)}
        onBlur={()=>setTimeout(()=>setOpen(false), 200)}
        placeholder={placeholder}
        style={inp}
      />
      {open && filtered.length>0 && (
        <div style={{position:"absolute",top:"100%",left:0,right:0,marginTop:"4px",background:C.s2,border:`1px solid ${C.borderHi}`,borderRadius:"7px",maxHeight:"260px",overflowY:"auto",zIndex:100,boxShadow:"0 6px 20px rgba(0,0,0,0.5)"}}>
          {filtered.map(o=>(
            <div key={o.id} onMouseDown={()=>{onSelect(o); setQ(""); setOpen(false);}}
              style={{padding:"10px 12px",cursor:"pointer",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:"10px"}}
              onMouseEnter={e=>e.currentTarget.style.background=C.s3}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <div style={{width:"28px",height:"28px",borderRadius:"6px",background:C.s1,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"11px",fontWeight:"700",color:C.muted,flexShrink:0}}>
                {initials(o.name)}
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:"13px",fontWeight:"600",color:C.text}}>{o.name}</div>
                <div style={{fontSize:"10px",color:C.muted,marginTop:"1px"}}>
                  {o.role}{o.phone?` · ${o.phone}`:""}
                </div>
              </div>
              {o.role==="Supervisor" && <span style={badge(C.gold,C.goldBg)}>SUP</span>}
              {availabilityOf && (()=>{
                const a = availabilityOf(o);
                if(!a) return null;
                const col = a==="available"?C.green:a==="tentative"?C.gold:C.red;
                const bg  = a==="available"?C.greenBg:a==="tentative"?C.goldBg:C.redBg;
                return <span style={badge(col,bg)}>{a==="available"?"FREE":a==="tentative"?"MAYBE":"BUSY"}</span>;
              })()}
            </div>
          ))}
        </div>
      )}
      {open && q && filtered.length===0 && (
        <div style={{position:"absolute",top:"100%",left:0,right:0,marginTop:"4px",background:C.s2,border:`1px solid ${C.border}`,borderRadius:"7px",padding:"12px",zIndex:100,fontSize:"11px",color:C.muted,textAlign:"center"}}>
          No matches. Add this person to the roster first.
        </div>
      )}
    </div>
  );
}

// Time input that handles AM/PM display – internally 24-hour, displays 12-hour
function TimeInput({value, onChange}) {
  // value is stored as "3:00 PM" format. Three quick dropdowns instead of the
  // native full clock: hour, minutes in 15-min steps, AM/PM.
  const m = (value||"").match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  const hour = m ? String(parseInt(m[1])) : "";
  const minute = m ? m[2] : "";
  const ampm = m ? m[3].toUpperCase() : "";
  const MINUTES = ["00","15","30","45"];
  // A pasted brief can carry an off-interval minute (e.g. 7:20) — keep it
  // selectable rather than silently snapping it.
  const minuteOpts = minute && !MINUTES.includes(minute) ? [minute, ...MINUTES] : MINUTES;

  const emit = (h, mn, ap) => {
    if(!h) { onChange(""); return; }
    onChange(`${h}:${mn||"00"} ${ap||"AM"}`);
  };
  const sel = {...inp, padding:"10px 6px", textAlign:"center", appearance:"auto", cursor:"pointer"};

  return (
    <div style={{display:"flex",gap:"5px",alignItems:"center",marginTop:"4px"}}>
      <select value={hour} onChange={e=>emit(e.target.value, minute, ampm)} style={{...sel,flex:1.2}} aria-label="hour">
        <option value="">–</option>
        {Array.from({length:12},(_,i)=>String(i+1)).map(h=><option key={h} value={h}>{h}</option>)}
      </select>
      <span style={{color:C.dim,fontWeight:"700"}}>:</span>
      <select value={minute||"00"} onChange={e=>emit(hour||"12", e.target.value, ampm)} style={{...sel,flex:1.2}} disabled={!hour} aria-label="minutes">
        {minuteOpts.map(mn=><option key={mn} value={mn}>{mn}</option>)}
      </select>
      <select value={ampm||"AM"} onChange={e=>emit(hour||"12", minute, e.target.value)} style={{...sel,flex:1.1}} disabled={!hour} aria-label="AM or PM">
        <option>AM</option><option>PM</option>
      </select>
    </div>
  );
}

// Role tag picker - select from defaults or add custom
function RoleTagPicker({value, onChange, customTags=[], onAddCustom, compact=false}) {
  const [adding, setAdding] = useState(false);
  const [custom, setCustom] = useState("");
  const allTags = [...DEFAULT_ROLE_TAGS, ...customTags.map(t=>({code:t.code,label:t.label,color:t.color||C.muted}))];

  function add() {
    const code = custom.trim().toUpperCase();
    if(!code || code.length>10) return;
    if(allTags.find(t=>t.code===code)) { onChange(code); setCustom(""); setAdding(false); return; }
    if(onAddCustom) onAddCustom({code,label:code,color:C.blue});
    onChange(code);
    setCustom("");
    setAdding(false);
  }

  return (
    <div>
      <div style={{display:"flex",flexWrap:"wrap",gap:"5px"}}>
        <button onClick={()=>onChange(null)} style={{
          padding: compact?"4px 7px":"5px 10px",
          fontSize:"9px",fontWeight:"700",letterSpacing:"0.08em",
          background:!value?C.s3:"transparent",color:!value?C.text:C.dim,
          border:`1px solid ${!value?C.borderHi:C.border}`,borderRadius:"5px",cursor:"pointer",fontFamily:C.font,
        }}>NONE</button>
        {allTags.map(t=>{
          const sel = value===t.code;
          return (
            <button key={t.code} onClick={()=>onChange(t.code)} style={{
              padding: compact?"4px 7px":"5px 10px",
              fontSize:"9px",fontWeight:"700",letterSpacing:"0.08em",
              background: sel ? t.color : "transparent",
              color: sel ? "#000" : t.color,
              border:`1px solid ${t.color}`,borderRadius:"5px",cursor:"pointer",fontFamily:C.font,
            }}>{t.code}</button>
          );
        })}
        {!adding && onAddCustom && (
          <button onClick={()=>setAdding(true)} style={{
            padding: compact?"4px 7px":"5px 10px",fontSize:"9px",
            background:"transparent",color:C.muted,border:`1px dashed ${C.border}`,borderRadius:"5px",cursor:"pointer",fontFamily:C.font,
          }}>+ CUSTOM</button>
        )}
      </div>
      {adding && (
        <div style={{display:"flex",gap:"5px",marginTop:"6px"}}>
          <input value={custom} onChange={e=>setCustom(e.target.value.toUpperCase())} onKeyDown={e=>e.key==="Enter"&&add()}
            placeholder="e.g. RIGGER" maxLength={10} style={{...inp,padding:"6px 10px",fontSize:"11px",flex:1}} autoFocus/>
          <button onClick={add} style={{...btn("gold"),padding:"6px 10px",fontSize:"10px"}}>ADD</button>
          <button onClick={()=>{setAdding(false);setCustom("");}} style={{...btn("ghost"),padding:"6px 10px",fontSize:"10px",border:`1px solid ${C.border}`}}>✕</button>
        </div>
      )}
    </div>
  );
}

// Calendar Add Menu - opens picker for Google / Apple / Outlook
function CalendarAddMenu({shift}) {
  const [open, setOpen] = useState(false);

  function handleICS() {
    const ok = downloadICS(shift);
    if(!ok) alert("Could not generate .ics file. Check shift date and time.");
    setOpen(false);
  }

  function handleGoogle() {
    const url = googleCalendarUrl(shift);
    if(!url) { alert("Could not generate Google Calendar link. Check shift date and time."); return; }
    window.open(url, "_blank", "noopener,noreferrer");
    setOpen(false);
  }

  function handleOutlook() {
    const url = outlookCalendarUrl(shift);
    if(!url) { alert("Could not generate Outlook link. Check shift date and time."); return; }
    window.open(url, "_blank", "noopener,noreferrer");
    setOpen(false);
  }

  return (
    <div style={{position:"relative",display:"inline-block"}}>
      <button onClick={()=>setOpen(!open)}
        style={{background:"transparent",fontSize:"10px",color:C.blue,border:`1px solid ${C.blue}`,borderRadius:"5px",padding:"6px 10px",letterSpacing:"0.1em",cursor:"pointer",fontFamily:C.font,fontWeight:"700"}}>
        📅 ADD TO CALENDAR ▾
      </button>
      {open && (
        <>
          <div onClick={()=>setOpen(false)} style={{position:"fixed",inset:0,zIndex:200}}/>
          <div style={{position:"absolute",top:"100%",left:0,marginTop:"6px",background:C.s2,border:`1.5px solid ${C.borderHi}`,borderRadius:"8px",padding:"6px",zIndex:201,boxShadow:"0 6px 20px rgba(0,0,0,0.6)",minWidth:"200px"}}>
            <button onClick={handleGoogle} style={{display:"flex",alignItems:"center",gap:"10px",padding:"10px 12px",width:"100%",background:"transparent",border:"none",color:C.text,cursor:"pointer",fontSize:"12px",fontFamily:C.font,borderRadius:"5px",textAlign:"left"}}
              onMouseEnter={e=>e.currentTarget.style.background=C.s3}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <span style={{fontSize:"16px"}}>📅</span>
              <div>
                <div style={{fontWeight:"700"}}>Google Calendar</div>
                <div style={{fontSize:"9px",color:C.muted}}>Opens in new tab</div>
              </div>
            </button>
            <button onClick={handleICS} style={{display:"flex",alignItems:"center",gap:"10px",padding:"10px 12px",width:"100%",background:"transparent",border:"none",color:C.text,cursor:"pointer",fontSize:"12px",fontFamily:C.font,borderRadius:"5px",textAlign:"left"}}
              onMouseEnter={e=>e.currentTarget.style.background=C.s3}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <span style={{fontSize:"16px"}}>🍎</span>
              <div>
                <div style={{fontWeight:"700"}}>Apple Calendar / Other</div>
                <div style={{fontSize:"9px",color:C.muted}}>Downloads .ics file</div>
              </div>
            </button>
            <button onClick={handleOutlook} style={{display:"flex",alignItems:"center",gap:"10px",padding:"10px 12px",width:"100%",background:"transparent",border:"none",color:C.text,cursor:"pointer",fontSize:"12px",fontFamily:C.font,borderRadius:"5px",textAlign:"left"}}
              onMouseEnter={e=>e.currentTarget.style.background=C.s3}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <span style={{fontSize:"16px"}}>📨</span>
              <div>
                <div style={{fontWeight:"700"}}>Outlook</div>
                <div style={{fontSize:"9px",color:C.muted}}>Opens in new tab</div>
              </div>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── ACTIVE SHIFT TIMELINE (live progress through current shift) ─────────────
function ShiftTimeline({shift}) {
  const [now, setNow] = useState(new Date());
  useEffect(()=>{
    const t = setInterval(()=>setNow(new Date()), 60000); // tick every minute
    return ()=>clearInterval(t);
  },[]);

  const prog = shiftProgress(shift, now);
  if (!prog) return null;

  const totalMinutes = (prog.end - prog.start) / 60000;
  const tickEveryHour = totalMinutes > 60;
  const ticks = [];
  if (tickEveryHour) {
    const startHour = new Date(prog.start);
    startHour.setMinutes(0,0,0);
    let cur = new Date(startHour);
    while (cur <= prog.end) {
      if (cur >= prog.start) {
        const pct = (cur - prog.start) / (prog.end - prog.start);
        ticks.push({pct, label: fmtHour12(cur.getHours())});
      }
      cur.setHours(cur.getHours()+1);
    }
  }

  const stateText = prog.state==="before" ? "Shift hasn't started yet"
                  : prog.state==="after" ? "Shift ended"
                  : "Live · in progress";
  const stateColor = prog.state==="before" ? C.muted : prog.state==="after" ? C.dim : C.green;

  return (
    <div style={{...card(),padding:"14px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"10px"}}>
        <span style={lbl}>⏱ Timeline</span>
        <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
          {prog.state==="during" && <div style={{width:"7px",height:"7px",borderRadius:"50%",background:C.green,animation:"pulse 1.5s infinite"}}/>}
          <span style={{fontSize:"10px",color:stateColor,fontWeight:"700",letterSpacing:"0.06em"}}>{stateText}</span>
        </div>
      </div>

      {/* Timeline bar */}
      <div style={{position:"relative",height:"40px",marginBottom:"8px"}}>
        {/* Background track */}
        <div style={{position:"absolute",top:"16px",left:0,right:0,height:"8px",background:C.s2,borderRadius:"4px",border:`1px solid ${C.border}`}}/>
        {/* Filled portion */}
        <div style={{position:"absolute",top:"16px",left:0,width:`${prog.pct*100}%`,height:"8px",background:`linear-gradient(90deg, ${C.gold}, ${C.green})`,borderRadius:"4px",transition:"width 1s ease"}}/>
        {/* Hour ticks */}
        {ticks.map((t,i)=>(
          <div key={i} style={{position:"absolute",top:"12px",left:`${t.pct*100}%`,width:"1px",height:"16px",background:C.dim,transform:"translateX(-0.5px)"}}/>
        ))}
        {/* Current time marker */}
        {prog.state==="during" && (
          <div style={{position:"absolute",top:"6px",left:`${prog.pct*100}%`,transform:"translateX(-50%)"}}>
            <div style={{width:"14px",height:"14px",borderRadius:"50%",background:C.green,border:"3px solid #000",boxShadow:`0 0 8px ${C.green}`,marginTop:"6px"}}/>
            <div style={{fontSize:"9px",color:C.green,fontWeight:"700",whiteSpace:"nowrap",marginTop:"4px",transform:"translateX(-50%)",position:"relative",left:"7px"}}>NOW</div>
          </div>
        )}
      </div>

      {/* Endpoint labels */}
      <div style={{display:"flex",justifyContent:"space-between",fontSize:"10px",color:C.muted}}>
        <div>
          <div style={{fontWeight:"700",color:C.text}}>{shift.callTime}</div>
          <div style={{fontSize:"9px"}}>call</div>
        </div>
        <div style={{textAlign:"center"}}>
          <div style={{fontWeight:"700",color:C.gold,fontSize:"11px"}}>{Math.round(prog.pct*100)}%</div>
          <div style={{fontSize:"9px"}}>complete</div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontWeight:"700",color:C.text}}>{shift.endTime||"—"}</div>
          <div style={{fontSize:"9px"}}>end</div>
        </div>
      </div>

      {/* Time remaining / elapsed */}
      {prog.state==="during" && (
        <div style={{marginTop:"10px",padding:"8px 10px",background:C.greenBg,border:`1px solid ${C.green}`,borderRadius:"6px",textAlign:"center"}}>
          <div style={{fontSize:"11px",color:C.green,fontWeight:"700"}}>
            {fmtHours((prog.end - now)/3600000)} remaining
          </div>
        </div>
      )}
    </div>
  );
}

// ─── DAILY TIMELINE (24h overview for home screen) ───────────────────────────
function DailyTimeline({shifts, currentUserRosterId}) {
  const [now, setNow] = useState(new Date());
  useEffect(()=>{
    const t = setInterval(()=>setNow(new Date()), 60000);
    return ()=>clearInterval(t);
  },[]);

  // Get today's shifts where user is on crew
  const today = new Date(now);
  today.setHours(0,0,0,0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate()+1);

  const todayShifts = shifts.filter(s => {
    if (currentUserRosterId && !s.crew.find(c=>c.rosterId===currentUserRosterId)) return false;
    const start = parseShiftStart(s.date, s.callTime);
    if (!start) return false;
    return start >= today && start < tomorrow;
  });

  const nowPct = ((now - today) / 86400000) * 100;

  return (
    <div style={{...card(),padding:"14px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"10px"}}>
        <span style={lbl}>📅 Today</span>
        <span style={{fontSize:"10px",color:C.gold,fontFamily:C.head,letterSpacing:"0.08em"}}>
          {now.toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}
        </span>
      </div>

      {/* 24h bar */}
      <div style={{position:"relative",height:"32px",background:C.s2,borderRadius:"5px",border:`1px solid ${C.border}`,overflow:"hidden"}}>
        {/* Hour markers - every 6 hours */}
        {[0,6,12,18].map(h => (
          <div key={h} style={{position:"absolute",left:`${(h/24)*100}%`,top:0,bottom:0,width:"1px",background:C.border}}/>
        ))}
        {/* Shifts plotted */}
        {todayShifts.map(s => {
          const start = parseShiftStart(s.date, s.callTime);
          const end = getShiftEnd(start, s.endTime);
          if (!start || !end) return null;
          const startMin = (start - today) / 60000;
          const endMin = Math.min((end - today) / 60000, 24*60);
          const leftPct = (startMin / (24*60)) * 100;
          const widthPct = ((endMin - startMin) / (24*60)) * 100;
          const isActive = now >= start && now <= end;
          return (
            <div key={s.id} title={s.client} style={{
              position:"absolute",
              left:`${leftPct}%`,
              width:`${widthPct}%`,
              top:"4px",
              bottom:"4px",
              background: isActive ? "#E8C84A" : C.goldBg,
              border:`1px solid ${C.gold}`,
              borderRadius:"3px",
              padding:"2px 4px",
              fontSize:"9px",
              color: isActive ? "#1a1400" : C.gold,
              fontWeight:"700",
              overflow:"hidden",
              whiteSpace:"nowrap",
              textOverflow:"ellipsis",
              display:"flex",
              alignItems:"center",
            }}>
              {s.client}
            </div>
          );
        })}
        {/* Now indicator */}
        <div style={{position:"absolute",left:`${nowPct}%`,top:0,bottom:0,width:"2px",background:C.green,boxShadow:`0 0 6px ${C.green}`,transform:"translateX(-1px)"}}/>
      </div>

      {/* Hour labels */}
      <div style={{display:"flex",justifyContent:"space-between",marginTop:"4px",fontSize:"9px",color:C.dim}}>
        <span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>11p</span>
      </div>

      {todayShifts.length === 0 && (
        <div style={{fontSize:"10px",color:C.muted,marginTop:"8px",textAlign:"center"}}>
          No shifts today
        </div>
      )}
    </div>
  );
}

// ─── LAST UPDATED BADGE ──────────────────────────────────────────────────────
function LastUpdatedBadge({timestamp, by, prominent=false}) {
  const [, force] = useState(0);
  useEffect(()=>{
    const t = setInterval(()=>force(n=>n+1), 30000);
    return ()=>clearInterval(t);
  },[]);

  if (!timestamp) return null;
  const diff = (Date.now() - new Date(timestamp).getTime()) / 1000;
  let label;
  if (diff < 60) label = "just now";
  else if (diff < 3600) label = `${Math.floor(diff/60)}m ago`;
  else if (diff < 86400) label = `${Math.floor(diff/3600)}h ago`;
  else label = `${Math.floor(diff/86400)}d ago`;

  const isLive = diff < 300; // <5 min = "live"
  const bg = prominent ? (isLive ? C.greenBg : C.s2) : "transparent";
  const color = isLive ? C.green : C.muted;
  const border = prominent ? `1px solid ${isLive ? C.green : C.border}` : "none";

  return (
    <div style={{
      display:"inline-flex",alignItems:"center",gap:"6px",
      padding: prominent ? "5px 10px" : "2px 0",
      background: bg,
      border,
      borderRadius:"5px",
      fontSize: prominent ? "10px" : "9px",
      color,
      fontWeight: prominent ? "700" : "400",
      letterSpacing: prominent ? "0.08em" : "0",
    }}>
      {isLive && <div style={{width:"6px",height:"6px",borderRadius:"50%",background:color,animation:"pulse 1.5s infinite"}}/>}
      <span>{prominent ? "LAST UPDATED " : "Updated "}{label}</span>
      {by && <span style={{color:C.dim}}>· by {by.split(" ")[0]}</span>}
    </div>
  );
}

// ─── SAVE TO ROSTER MODAL ────────────────────────────────────────────────────
function SaveToRosterModal({person, onSave, onSkip, onClose}) {
  const [form, setForm] = useState({
    name: person.name || "",
    role: person.role || "Crew",
    phone: person.phone || "",
    email: person.email || "",
    pin: "0000",
  });

  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.s1,border:`1.5px solid ${C.gold}`,borderRadius:"12px",padding:"24px",maxWidth:"460px",width:"100%"}}>
        <div style={{fontFamily:C.head,fontSize:"22px",letterSpacing:"0.08em",color:C.gold,marginBottom:"6px"}}>SAVE NEW PERSON?</div>
        <div style={{fontSize:"11px",color:C.muted,lineHeight:"1.5",marginBottom:"16px"}}>
          Add <b style={{color:C.text}}>{person.name}</b> to your master roster so they appear in future shifts? You can edit details now.
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:"10px",marginBottom:"16px"}}>
          <div>
            <span style={lbl}>Name</span>
            <input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} style={{...inp,marginTop:"4px"}}/>
          </div>
          <div>
            <span style={lbl}>Role</span>
            <select value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value}))} style={{...inp,marginTop:"4px",appearance:"none"}}>
              <option value="Crew">Crew</option>
              <option value="Supervisor">Supervisor</option>
            </select>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
            <div>
              <span style={lbl}>Phone</span>
              <input value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))} placeholder="(555) 000-0000" style={{...inp,marginTop:"4px"}}/>
            </div>
            <div>
              <span style={lbl}>Login PIN</span>
              <input value={form.pin} onChange={e=>setForm(f=>({...f,pin:e.target.value.replace(/\D/g,"").slice(0,4)}))} placeholder="0000" style={{...inp,marginTop:"4px"}}/>
            </div>
          </div>
          <div>
            <span style={lbl}>Email</span>
            <input value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} placeholder="name@email.com" style={{...inp,marginTop:"4px"}}/>
          </div>
        </div>

        <div style={{display:"flex",gap:"8px"}}>
          <button onClick={()=>onSkip()} style={{...btn("ghost"),flex:1,border:`1px solid ${C.border}`}}>JUST THIS SHIFT</button>
          <button onClick={()=>onSave(form)} disabled={!form.name.trim()} style={{...btn("gold"),flex:1.3,opacity:form.name.trim()?1:0.4}}>SAVE TO ROSTER</button>
        </div>
        <div style={{fontSize:"9px",color:C.dim,marginTop:"10px",textAlign:"center",lineHeight:"1.4"}}>
          Saved people show up in search and can be re-added to any shift later.
        </div>
      </div>
    </div>
  );
}

// ─── HOURS ADJUSTMENT MODAL ──────────────────────────────────────────────────
function HoursAdjustModal({member, shiftClient, onSave, onClose}) {
  const auto = calcHours(member.clockIn, member.clockOut);
  const [hours, setHours] = useState(member.manualHours ?? auto.total);
  const [reason, setReason] = useState("");

  const isAdjusted = Math.abs(hours - auto.total) > 0.01;
  const ot = Math.max(0, hours - OT_THRESHOLD_HOURS);
  const reg = Math.min(hours, OT_THRESHOLD_HOURS);

  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.s1,border:`1.5px solid ${C.gold}`,borderRadius:"12px",padding:"24px",maxWidth:"440px",width:"100%"}}>
        <div style={{fontFamily:C.head,fontSize:"22px",letterSpacing:"0.08em",color:C.gold,marginBottom:"4px"}}>ADJUST HOURS</div>
        <div style={{fontSize:"11px",color:C.muted,marginBottom:"16px"}}>
          {shiftClient} · {member.name}
        </div>

        <div style={{background:C.s2,borderRadius:"7px",padding:"10px",marginBottom:"14px"}}>
          <div style={{fontSize:"10px",color:C.muted,letterSpacing:"0.1em",marginBottom:"4px"}}>AUTO-CALCULATED</div>
          <div style={{fontSize:"14px",color:C.text,fontWeight:"700"}}>{fmtHours(auto.total)}</div>
          {member.clockIn && member.clockOut ? (
            <div style={{fontSize:"9px",color:C.dim,marginTop:"2px"}}>
              In {new Date(member.clockIn).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})} → Out {new Date(member.clockOut).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}
            </div>
          ) : <div style={{fontSize:"9px",color:C.dim}}>No clock data</div>}
        </div>

        <div style={{marginBottom:"14px"}}>
          <span style={lbl}>Adjusted Hours</span>
          <div style={{display:"flex",gap:"6px",marginTop:"6px",alignItems:"center"}}>
            <button onClick={()=>setHours(h=>Math.max(0, parseFloat((h-0.25).toFixed(2))))} style={{...btn("ghost"),padding:"10px 14px",border:`1px solid ${C.border}`,fontSize:"16px"}}>−</button>
            <input type="number" step="0.25" min="0" max="24" value={hours} onChange={e=>setHours(parseFloat(e.target.value)||0)} style={{...inp,flex:1,textAlign:"center",fontSize:"18px",fontWeight:"700"}}/>
            <button onClick={()=>setHours(h=>parseFloat((h+0.25).toFixed(2)))} style={{...btn("ghost"),padding:"10px 14px",border:`1px solid ${C.border}`,fontSize:"16px"}}>+</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"4px",marginTop:"8px"}}>
            {[4,6,8,10,12].map(q=>(
              <button key={q} onClick={()=>setHours(q)} style={{...btn("ghost"),padding:"6px",fontSize:"10px",border:`1px solid ${C.border}`,color:C.muted}}>{q}h</button>
            ))}
          </div>
        </div>

        {/* Breakdown */}
        <div style={{background:C.s2,borderRadius:"7px",padding:"10px",marginBottom:"14px"}}>
          <div style={{display:"flex",justifyContent:"space-between",padding:"3px 0",fontSize:"11px"}}>
            <span style={{color:C.muted}}>Regular (up to {OT_THRESHOLD_HOURS}h)</span>
            <span style={{color:C.text,fontWeight:"700"}}>{fmtHours(reg)}</span>
          </div>
          {ot > 0 && (
            <div style={{display:"flex",justifyContent:"space-between",padding:"3px 0",fontSize:"11px"}}>
              <span style={{color:C.gold}}>Overtime (over {OT_THRESHOLD_HOURS}h)</span>
              <span style={{color:C.gold,fontWeight:"700"}}>{fmtHours(ot)}</span>
            </div>
          )}
          <div style={{borderTop:`1px solid ${C.border}`,marginTop:"4px",paddingTop:"4px",display:"flex",justifyContent:"space-between",fontSize:"12px"}}>
            <span style={{color:C.text,fontWeight:"700"}}>Total</span>
            <span style={{color:isAdjusted?C.gold:C.text,fontWeight:"700"}}>{fmtHours(hours)}</span>
          </div>
        </div>

        {isAdjusted && (
          <div style={{marginBottom:"14px"}}>
            <span style={lbl}>Reason (optional)</span>
            <input value={reason} onChange={e=>setReason(e.target.value)} placeholder="e.g. arrived 30 min early to set up" style={{...inp,marginTop:"4px"}}/>
          </div>
        )}

        <div style={{display:"flex",gap:"8px"}}>
          <button onClick={onClose} style={{...btn("ghost"),flex:1,border:`1px solid ${C.border}`}}>CANCEL</button>
          {isAdjusted && <button onClick={()=>{onSave(null, ""); onClose();}} style={{...btn("ghost"),flex:1,border:`1px solid ${C.muted}`,color:C.muted}}>RESET AUTO</button>}
          <button onClick={()=>{onSave(hours, reason); onClose();}} style={{...btn("gold"),flex:1.4}}>SAVE</button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════════════════════
export default function App({ sessionUser = null }) {
  const [state, setState] = useState(INIT);
  const [loaded, setLoaded] = useState(false);
  const [screen, setScreen] = useState("login"); // login | home | shift | admin | calendar | hours | availability | newshift | message
  const [currentUser, setCurrentUser] = useState(null); // {id, name, role:"manager"|"crew"}
  const [activeShiftId, setActiveShiftId] = useState(null);
  // Single source of truth for dark/light across the WHOLE site (next-themes).
  const { theme, setTheme } = useTheme();
  const autoLoggedIn = useRef(false);
  // Live-sync bookkeeping: skip polling while a save is in flight, and remember
  // the server's latest version so polls only apply genuinely newer data.
  const savingRef = useRef(false);
  const lastServerUpdatedAtRef = useRef(null);
  const [saveError, setSaveError] = useState(false);

  // Apply the demo's CSS variables whenever the shared theme changes.
  useEffect(()=>{
    applyTheme(theme === "dark" ? "dark" : "light");
  },[theme]);

  useEffect(()=>{
    load().then(res=>{
      if(res?.data){ setState(s=>({...INIT,...res.data})); lastServerUpdatedAtRef.current = res.updatedAt; }
      setLoaded(true);
    });
  },[]);

  // Live sync: every 12s pull the shared workspace so one device sees another's
  // changes without a refresh. Skips while we're mid-save, and only applies data
  // the server marks as newer than what we already have (avoids clobbering our
  // own just-saved edits or re-rendering for nothing).
  useEffect(()=>{
    if(!loaded) return;
    const t = setInterval(async ()=>{
      if(savingRef.current) return;
      const res = await load();
      if(!res?.data || savingRef.current) return;
      const srv = res.updatedAt ? new Date(res.updatedAt).getTime() : 0;
      const seen = lastServerUpdatedAtRef.current ? new Date(lastServerUpdatedAtRef.current).getTime() : 0;
      if(srv && seen && srv <= seen) return;
      lastServerUpdatedAtRef.current = res.updatedAt || lastServerUpdatedAtRef.current;
      setState(s=>({...INIT,...res.data}));
    }, 12000);
    return ()=>clearInterval(t);
  },[loaded]);

  // Single save path: marks us busy (so polling backs off), records the server's
  // new version on success, and flips the save-error banner on failure.
  // Declared before the effects below so the auto-login effect can call it.
  const flush = useCallback((payload) => {
    // Keep the notification log bounded — it's prepended newest-first, so trim the
    // tail. Without this it grows forever and bloats every load/poll.
    if (payload && Array.isArray(payload.notifications) && payload.notifications.length > 60) {
      payload = { ...payload, notifications: payload.notifications.slice(0, 60) };
    }
    savingRef.current = true;
    save(payload).then(r => {
      if (r && r.ok) {
        if (r.updatedAt) lastServerUpdatedAtRef.current = r.updatedAt;
        setSaveError(false);
      } else {
        setSaveError(true);
      }
    }).finally(() => { savingRef.current = false; });
  },[]);

  // Accepts a full next-state object OR a functional updater (prev => next).
  // Handlers that can fire twice before a re-render (rapid taps) must use the
  // functional form so the second write builds on the first, not on a stale
  // render snapshot.
  const persist = useCallback((newStateOrFn) => {
    setState(prev => {
      const raw = typeof newStateOrFn === "function" ? newStateOrFn(prev) : newStateOrFn;
      // Keep the in-memory notification list at the same cap the server uses,
      // so what a user sees in-session matches what survives a reload.
      const ns = (raw.notifications||[]).length > 60
        ? { ...raw, notifications: raw.notifications.slice(0,60) } : raw;
      flush({roster:ns.roster,shifts:ns.shifts,notifications:ns.notifications,availability:ns.availability,expenses:ns.expenses||[],customRoleTags:ns.customRoleTags||[],removedIdentities:ns.removedIdentities||[]});
      return ns;
    });
  },[flush]);

  // Auto-login from the real NextAuth session — skips the demo's own login
  // screen entirely. Role decides which portal opens (manager vs crew).
  useEffect(()=>{
    if(!sessionUser || !loaded || autoLoggedIn.current) return;
    if(sessionUser.role === "manager"){
      // Use the real account id so each manager has a distinct, stable identity —
      // a hardcoded "manager" string made every manager share one expense bucket.
      setCurrentUser({ id: sessionUser.id || "manager", name:sessionUser.name || "Manager", role:"manager" });
    } else {
      // Match the crew member to their roster entry: primary account id, any
      // linked account id, then email, then name as a legacy fallback.
      const su = sessionUser;
      const roster = state.roster || [];
      const boundTo = (m) => m.userId === su.id || (m.linkedUserIds||[]).includes(su.id);
      const match =
        (su.id && roster.find(m => boundTo(m) || m.id === su.id)) ||
        (su.email && roster.find(m => (m.email||"").toLowerCase() === su.email.toLowerCase())) ||
        roster.find(m => (m.name||"").toLowerCase() === (su.name||"").toLowerCase());
      if(match){
        // Bind this account to the entry permanently. If the entry already
        // belongs to a DIFFERENT account (same person, second Google email),
        // LINK the new id instead of overwriting — overwriting made two
        // accounts ping-pong the binding on every alternate login.
        const needsBind = su.id && !boundTo(match);
        // Heal orphaned money data: expenses stamped with this account that
        // ended up keyed under a different roster id follow the person here.
        const rekey = (state.expenses||[]).some(e => e.accountId===su.id && e.userId!==match.id);
        if(needsBind || rekey){
          persist({...state,
            roster: roster.map(m => m.id===match.id
              ? {...m,
                  userId: m.userId || su.id,
                  linkedUserIds: (m.userId && m.userId !== su.id && !(m.linkedUserIds||[]).includes(su.id))
                    ? [...(m.linkedUserIds||[]), su.id] : (m.linkedUserIds||[]),
                  email: m.email || su.email || ""}
              : m),
            expenses: (state.expenses||[]).map(e =>
              e.accountId===su.id && e.userId!==match.id ? {...e, userId:match.id} : e),
          });
        }
        setCurrentUser({ id:match.id, name:match.name, role:"crew", rosterId:match.id, accountId:su.id });
      } else if((state.removedIdentities||[]).some(r =>
          (su.id && (r.userId===su.id || (r.linkedUserIds||[]).includes(su.id))) ||
          (su.email && r.email && r.email.toLowerCase()===su.email.toLowerCase()) ||
          (su.name && r.name && r.name.toLowerCase()===su.name.toLowerCase()))){
        // Manager deleted this person from the roster — do NOT resurrect them
        // via self-registration. They can view nothing until re-added.
        setCurrentUser({ id: su.id || uid(), name: su.name || "Crew", role:"crew", accountId:su.id, removed:true });
      } else {
        // First sign-in with no manager-created roster entry: self-register them so
        // they appear in the roster for assignment and own a stable identity.
        const newMember = {
          id: uid(), userId: su.id || undefined, name: su.name || "Crew",
          role:"Crew", position:"Crew", phone:"", email: su.email || "", pin:"",
          available:true, active:true, notes:"", tags:[], selfRegistered:true,
        };
        persist({...state, roster:[...roster, newMember]});
        setCurrentUser({ id:newMember.id, name:newMember.name, role:"crew", rosterId:newMember.id, accountId:su.id });
      }
    }
    autoLoggedIn.current = true;
    setScreen("home");
  },[sessionUser, loaded, state.roster]);

  // When a session-gated user logs out of the demo, run the real sign-out.
  useEffect(()=>{
    if(sessionUser && autoLoggedIn.current && !currentUser){
      window.location.href = "/api/auth/signout?callbackUrl=/login";
    }
  },[currentUser, sessionUser]);

  // Helper: update a single shift and auto-stamp lastUpdated.
  // Pass updater function (oldShift) => newShift or a plain shift object.
  const updateShift = useCallback((shiftId, updater, updatedByName, extraNotifs) => {
    setState(prevState => {
      const newShifts = prevState.shifts.map(s => {
        if (s.id !== shiftId) return s;
        const updated = typeof updater === "function" ? updater(s) : { ...s, ...updater };
        return { ...updated, lastUpdated: now(), updatedBy: updatedByName || "" };
      });
      // extraNotifs ride in the same state update so the shift change and its
      // notification can't get separated by a poll landing between two saves.
      const ns = { ...prevState, shifts: newShifts,
        notifications: extraNotifs?.length ? [...extraNotifs, ...prevState.notifications] : prevState.notifications };
      flush({roster:ns.roster,shifts:ns.shifts,notifications:ns.notifications,availability:ns.availability,expenses:ns.expenses||[],customRoleTags:ns.customRoleTags||[],removedIdentities:ns.removedIdentities||[]});
      return ns;
    });
  },[flush]);

  const activeShift = state.shifts.find(s=>s.id===activeShiftId) || state.shifts[0];

  if(!loaded) return <Spinner/>;
  // Gated by real auth: wait for auto-login instead of flashing the demo login.
  if(sessionUser && !currentUser) return <Spinner/>;

  // Route → compute the active screen, then wrap with the theme toggle.
  // Manager-only screens are hard-gated by role — nav buttons hide them from
  // crew, but a stale screen value (e.g. logout mid-Admin on a shared phone)
  // must not render them either.
  const MANAGER_ONLY = ["newshift","message","admin","roster","reports"];
  const effectiveScreen = (currentUser && currentUser.role!=="manager" && MANAGER_ONLY.includes(screen)) ? "home" : screen;
  let body;
  if(effectiveScreen==="login" || !currentUser) body = sessionUser ? <Spinner/> : <LoginScreen state={state} setCurrentUser={setCurrentUser} setScreen={setScreen}/>;
  else if(effectiveScreen==="calendar"||screen==="schedule") body = <ScheduleScreen state={state} persist={persist} setScreen={setScreen} currentUser={currentUser} activeShift={activeShift} setActiveShiftId={setActiveShiftId} initialView="calendar"/>;
  else if(effectiveScreen==="weekgrid") body = <ScheduleScreen state={state} persist={persist} setScreen={setScreen} currentUser={currentUser} activeShift={activeShift} setActiveShiftId={setActiveShiftId} initialView="week"/>;
  else if(effectiveScreen==="availability") body = <ScheduleScreen state={state} persist={persist} setScreen={setScreen} currentUser={currentUser} activeShift={activeShift} setActiveShiftId={setActiveShiftId} initialView="avail"/>;
  else if(effectiveScreen==="hours") body = <HoursScreen state={state} persist={persist} updateShift={updateShift} setScreen={setScreen} currentUser={currentUser} activeShift={activeShift}/>;
  else if(effectiveScreen==="expenses") body = <ExpenseScreen state={state} persist={persist} setScreen={setScreen} currentUser={currentUser}/>;
  else if(effectiveScreen==="newshift") body = <NewShiftScreen state={state} persist={persist} setScreen={setScreen} setActiveShiftId={setActiveShiftId} currentUser={currentUser}/>;
  else if(effectiveScreen==="message") body = <MessageScreen state={state} persist={persist} updateShift={updateShift} setScreen={setScreen} activeShift={state.shifts.find(s=>s.id===activeShiftId)||null} setActiveShiftId={setActiveShiftId} currentUser={currentUser}/>;
  else if(effectiveScreen==="shift") body = <ShiftScreen state={state} persist={persist} updateShift={updateShift} setScreen={setScreen} currentUser={currentUser} activeShift={activeShift}/>;
  else if(effectiveScreen==="admin") body = <AdminScreen state={state} persist={persist} updateShift={updateShift} setScreen={setScreen} currentUser={currentUser} activeShift={activeShift} setActiveShiftId={setActiveShiftId}/>;
  else if(effectiveScreen==="roster") body = <RosterScreen state={state} persist={persist} setScreen={setScreen} setActiveShiftId={setActiveShiftId}/>;
  else if(effectiveScreen==="search") body = <SearchScreen state={state} setScreen={setScreen} setActiveShiftId={setActiveShiftId} currentUser={currentUser}/>;
  else if(effectiveScreen==="reports") body = <ReportsScreen state={state} setScreen={setScreen} setActiveShiftId={setActiveShiftId}/>;
  else body = <HomeScreen state={state} persist={persist} setScreen={setScreen} currentUser={currentUser} setCurrentUser={setCurrentUser} activeShift={activeShift} setActiveShiftId={setActiveShiftId}/>;

  return <>{body}<ThemeToggle theme={theme} setTheme={setTheme}/>{saveError && <SaveErrorBanner onRetry={()=>{ setSaveError(false); flush({roster:state.roster,shifts:state.shifts,notifications:state.notifications,availability:state.availability,expenses:state.expenses||[],customRoleTags:state.customRoleTags||[],removedIdentities:state.removedIdentities||[]}); }} onDismiss={()=>setSaveError(false)}/>}</>;
}

// Shown when a write to the shared workspace fails, so a user never thinks an
// edit saved when it didn't. Retry re-sends the current state.
function SaveErrorBanner({onRetry, onDismiss}) {
  return (
    <div style={{position:"fixed",left:"50%",bottom:"16px",transform:"translateX(-50%)",zIndex:400,
      background:C.redBg,border:`1.5px solid ${C.red}`,borderRadius:"10px",padding:"10px 12px",
      display:"flex",alignItems:"center",gap:"10px",maxWidth:"92%",boxShadow:"0 6px 20px rgba(0,0,0,0.3)",fontFamily:C.font}}>
      <span style={{fontSize:"16px"}}>⚠️</span>
      <div style={{fontSize:"11px",color:C.text,lineHeight:1.4}}>
        <div style={{fontWeight:"700",color:C.red}}>Couldn’t save</div>
        <div style={{color:C.muted}}>Your last change didn’t reach the server.</div>
      </div>
      <button onClick={onRetry} style={{...btn("red"),padding:"6px 12px",fontSize:"10px"}}>RETRY</button>
      <button onClick={onDismiss} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:"16px",lineHeight:1,padding:"0 2px"}}>✕</button>
    </div>
  );
}

function ThemeToggle({theme, setTheme}) {
  const dark = theme === "dark";
  return (
    <button
      onClick={()=>setTheme(dark?"light":"dark")}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      style={{
        position:"fixed", right:"16px", bottom:"86px", zIndex:300,
        width:"46px", height:"46px", borderRadius:"50%",
        border:`2px solid ${C.borderHi}`, background:C.s1, color:C.text,
        fontSize:"19px", cursor:"pointer", display:"flex",
        alignItems:"center", justifyContent:"center",
        boxShadow:"0 4px 16px rgba(0,0,0,0.28)",
      }}
    >
      {dark ? "☀" : "☾"}
    </button>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SPINNER
// ══════════════════════════════════════════════════════════════════════════════
function Spinner() {
  return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"16px",fontFamily:C.font}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Bebas+Neue&display=swap');@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <Logo size={56}/>
      <div style={{width:"32px",height:"32px",border:`3px solid ${C.gold}`,borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
      <div style={{color:C.muted,fontSize:"11px",letterSpacing:"0.2em"}}>LOADING BIGCREW NYC...</div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// LOGIN
// ══════════════════════════════════════════════════════════════════════════════
function LoginScreen({state, setCurrentUser, setScreen}) {
  const [mode,setMode]=useState("select"); // select | crew | manager | crewpin | google
  const [pin,setPin]=useState("");
  const [err,setErr]=useState(false);
  const [selectedMember,setSelectedMember]=useState(null);
  const MANAGER_PIN="1234";

  function selectCrew(member) {
    setSelectedMember(member);
    setMode("crewpin");
    setPin("");
    setErr(false);
  }

  function loginAsCrew() {
    const expected = selectedMember.pin || "0000";
    if(pin === expected) {
      setCurrentUser({id:selectedMember.id,name:selectedMember.name,role:"crew",rosterId:selectedMember.id});
      setScreen("home");
    } else {
      setErr(true); setPin(""); setTimeout(()=>setErr(false),1500);
    }
  }

  function loginAsManager() {
    if(pin===MANAGER_PIN){
      setCurrentUser({id:"manager",name:"Manager",role:"manager"});
      setScreen("home");
    } else {
      setErr(true); setPin(""); setTimeout(()=>setErr(false),1500);
    }
  }

  // Demo google login (real OAuth needs backend) — picks first crew member or manager
  function demoGoogleLogin(asManager) {
    if(asManager) setCurrentUser({id:"manager",name:"Manager",role:"manager"});
    else {
      const m = state.roster[0];
      if(!m) return; // empty roster — nothing to demo as
      setCurrentUser({id:m.id,name:m.name,role:"crew",rosterId:m.id});
    }
    setScreen("home");
  }

  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:C.font,color:C.text,display:"flex",flexDirection:"column",alignItems:"center",padding:"32px 20px 60px"}}>
      <style>{GS}</style>
      <div style={{textAlign:"center",marginBottom:"32px"}}>
        <Logo size={72}/>
        <div style={{fontFamily:C.head,fontSize:"32px",letterSpacing:"0.12em",color:C.gold,marginTop:"12px",lineHeight:1}}>BIGCREW NYC</div>
        <div style={{fontSize:"10px",color:C.muted,letterSpacing:"0.2em",marginTop:"4px"}}>CREW MANAGEMENT SYSTEM</div>
      </div>

      {mode==="select" && (
        <div style={{width:"100%",maxWidth:"380px",display:"flex",flexDirection:"column",gap:"10px"}}>
          <div style={{...card(),border:`1.5px solid ${C.gold}`,padding:"20px",textAlign:"center",cursor:"pointer"}} onClick={()=>{setMode("manager");setPin("");}}>
            <div style={{fontSize:"28px",marginBottom:"8px"}}>🎛️</div>
            <div style={{fontFamily:C.head,fontSize:"22px",letterSpacing:"0.1em",color:C.gold}}>MANAGER LOGIN</div>
            <div style={{fontSize:"11px",color:C.muted,marginTop:"4px"}}>Admin access · PIN required</div>
          </div>
          <div style={{...card(),border:`1.5px solid ${C.border}`,padding:"20px",textAlign:"center",cursor:"pointer"}} onClick={()=>setMode("crew")}>
            <div style={{fontSize:"28px",marginBottom:"8px"}}>👤</div>
            <div style={{fontFamily:C.head,fontSize:"22px",letterSpacing:"0.1em",color:C.text}}>CREW LOGIN</div>
            <div style={{fontSize:"11px",color:C.muted,marginTop:"4px"}}>Your name + personal PIN</div>
          </div>

          {/* Divider */}
          <div style={{display:"flex",alignItems:"center",gap:"10px",margin:"4px 0"}}>
            <div style={{flex:1,height:"1px",background:C.border}}/>
            <div style={{fontSize:"9px",color:C.dim,letterSpacing:"0.2em"}}>OR</div>
            <div style={{flex:1,height:"1px",background:C.border}}/>
          </div>

          {/* Google */}
          <div onClick={()=>setMode("google")} style={{...card({padding:"14px"}),cursor:"pointer",display:"flex",alignItems:"center",gap:"12px",background:"#fff",border:`1px solid ${C.borderHi}`}}>
            <svg width="22" height="22" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.7 4.7-6.2 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.5 6.4 29.5 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5c10.9 0 19.5-7.9 19.5-19.5 0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8c1.8-4.4 6.1-7.5 11.1-7.5 3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.5 6.4 29.5 4.5 24 4.5c-7.7 0-14.4 4.4-17.7 10.7z"/><path fill="#4CAF50" d="M24 43.5c5.4 0 10.3-2.1 14-5.4l-6.5-5.5c-1.9 1.4-4.5 2.4-7.5 2.4-5.1 0-9.4-3.3-11-7.9l-6.6 5.1C9.5 39 16.2 43.5 24 43.5z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.5 5.5c4.6-4.3 7.7-10.6 7.7-18 0-1.3-.1-2.4-.4-3.5z"/></svg>
            <div style={{flex:1,color:"#1a1a1a"}}>
              <div style={{fontSize:"13px",fontWeight:"700"}}>Sign in with Google</div>
              <div style={{fontSize:"10px",color:"#666"}}>Continue with your work account</div>
            </div>
          </div>
        </div>
      )}

      {mode==="manager" && (
        <div style={{width:"100%",maxWidth:"340px"}}>
          <div style={{...card({border:`1.5px solid ${err?C.red:C.gold}`}),padding:"20px"}}>
            <span style={lbl}>Manager PIN</span>
            <input type="password" inputMode="numeric" autoFocus value={pin} onChange={e=>setPin(e.target.value)} onKeyDown={e=>e.key==="Enter"&&loginAsManager()}
              placeholder="••••" maxLength={6} style={{...inp,textAlign:"center",fontSize:"24px",letterSpacing:"0.3em",marginTop:"6px"}}/>
            {err && <div style={{color:C.red,fontSize:"11px",textAlign:"center",marginTop:"6px"}}>Incorrect PIN</div>}
            <button onClick={loginAsManager} style={{...btn("gold",true),marginTop:"12px"}}>ENTER</button>
          </div>
          <button onClick={()=>setMode("select")} style={{...btn("ghost",true),marginTop:"10px",border:`1px solid ${C.border}`}}>← Back</button>
          <div style={{textAlign:"center",color:C.dim,fontSize:"10px",marginTop:"12px"}}>Default PIN: 1234</div>
        </div>
      )}

      {mode==="crew" && (
        <div style={{width:"100%",maxWidth:"380px"}}>
          <div style={{...lbl,marginBottom:"12px",fontSize:"10px"}}>Select your name</div>
          <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
            {state.roster.map((m,i)=>(
              <div key={m.id} onClick={()=>selectCrew(m)}
                style={{...card(),display:"flex",alignItems:"center",gap:"12px",cursor:"pointer",animation:`fadeUp 0.3s ease ${i*0.05}s both`}}>
                <div style={{width:"38px",height:"38px",borderRadius:"8px",background:C.s2,border:`1.5px solid ${C.borderHi}`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:"700",fontSize:"13px",color:C.muted,flexShrink:0}}>{initials(m.name)}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:"14px",fontWeight:"700",color:C.text}}>{m.name}</div>
                  <div style={{fontSize:"10px",color:C.muted}}>{m.role} · 🔒 PIN required</div>
                </div>
                {m.role==="Supervisor"&&<span style={badge(C.gold,C.goldBg)}>SUP</span>}
                <span style={{color:C.dim,fontSize:"16px"}}>›</span>
              </div>
            ))}
          </div>
          <button onClick={()=>setMode("select")} style={{...btn("ghost",true),marginTop:"12px",border:`1px solid ${C.border}`}}>← Back</button>
        </div>
      )}

      {mode==="crewpin" && selectedMember && (
        <div style={{width:"100%",maxWidth:"340px"}}>
          <div style={{...card({border:`1.5px solid ${err?C.red:C.gold}`}),padding:"20px"}}>
            <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"12px"}}>
              <div style={{width:"36px",height:"36px",borderRadius:"8px",background:C.s2,border:`1.5px solid ${C.borderHi}`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:"700",fontSize:"13px",color:C.muted}}>{initials(selectedMember.name)}</div>
              <div>
                <div style={{fontSize:"15px",fontWeight:"700"}}>{selectedMember.name}</div>
                <div style={{fontSize:"10px",color:C.muted}}>{selectedMember.role}</div>
              </div>
            </div>
            <span style={lbl}>Your 4-digit PIN</span>
            <input type="password" inputMode="numeric" autoFocus value={pin} onChange={e=>setPin(e.target.value)} onKeyDown={e=>e.key==="Enter"&&loginAsCrew()}
              placeholder="••••" maxLength={6} style={{...inp,textAlign:"center",fontSize:"24px",letterSpacing:"0.3em",marginTop:"6px"}}/>
            {err && <div style={{color:C.red,fontSize:"11px",textAlign:"center",marginTop:"6px"}}>Incorrect PIN. Ask your manager to reset.</div>}
            <button onClick={loginAsCrew} style={{...btn("gold",true),marginTop:"12px"}}>SIGN IN</button>
          </div>
          <button onClick={()=>setMode("crew")} style={{...btn("ghost",true),marginTop:"10px",border:`1px solid ${C.border}`}}>← Back</button>
          <div style={{textAlign:"center",color:C.dim,fontSize:"10px",marginTop:"12px"}}>Default PIN: 0000 · Change in account</div>
        </div>
      )}

      {mode==="google" && (
        <div style={{width:"100%",maxWidth:"380px"}}>
          <div style={card({padding:"18px"})}>
            <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"12px"}}>
              <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.7 4.7-6.2 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.5 6.4 29.5 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5c10.9 0 19.5-7.9 19.5-19.5 0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8c1.8-4.4 6.1-7.5 11.1-7.5 3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.5 6.4 29.5 4.5 24 4.5c-7.7 0-14.4 4.4-17.7 10.7z"/><path fill="#4CAF50" d="M24 43.5c5.4 0 10.3-2.1 14-5.4l-6.5-5.5c-1.9 1.4-4.5 2.4-7.5 2.4-5.1 0-9.4-3.3-11-7.9l-6.6 5.1C9.5 39 16.2 43.5 24 43.5z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.5 5.5c4.6-4.3 7.7-10.6 7.7-18 0-1.3-.1-2.4-.4-3.5z"/></svg>
              <div style={{fontSize:"14px",fontWeight:"700"}}>Sign in with Google</div>
            </div>
            <div style={{background:C.blueBg,border:`1px solid ${C.blue}`,borderRadius:"8px",padding:"12px",marginBottom:"14px"}}>
              <div style={{fontSize:"11px",color:C.blue,fontWeight:"700",marginBottom:"4px",letterSpacing:"0.08em"}}>💡 PRODUCTION SETUP</div>
              <div style={{fontSize:"11px",color:C.text,lineHeight:"1.6"}}>Full Google OAuth requires a small backend (Firebase Auth, Supabase, or Auth0 — about 30 min of setup). Once live, crew sign in with their existing Google work account and BigCrew matches them to the roster automatically.</div>
            </div>
            <div style={{fontSize:"11px",color:C.muted,marginBottom:"8px"}}>Try the demo flow:</div>
            <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
              <button onClick={()=>demoGoogleLogin(true)} style={{...btn("gold",true)}}>DEMO AS MANAGER</button>
              <button onClick={()=>demoGoogleLogin(false)} style={{...btn("ghost",true),border:`1px solid ${C.border}`}}>DEMO AS {state.roster[0]?.name.split(" ")[0].toUpperCase()}</button>
            </div>
          </div>
          <button onClick={()=>setMode("select")} style={{...btn("ghost",true),marginTop:"10px",border:`1px solid ${C.border}`}}>← Back</button>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// HOME
// ══════════════════════════════════════════════════════════════════════════════
// Manager "Weekly Operations Overview" — replaces the Next Shift hero for managers
// who aren't personally assigned to the active shift.
function ManagerOpsOverview({state, setScreen, setActiveShiftId}) {
  const now = new Date();
  const weekEnd = new Date(now); weekEnd.setDate(weekEnd.getDate()+7);

  // Upcoming = shifts whose end (or start, if no end set) is in the future
  const upcoming = [...state.shifts]
    .map(s => ({s, start: parseShiftStart(s.date, s.callTime)}))
    .filter(x => x.start && (getShiftEnd(x.start, x.s.endTime) || x.start) >= now)
    .sort((a,b)=> a.start - b.start);

  const thisWeek = upcoming.filter(x => x.start <= weekEnd);

  // Aggregate counts
  let openPositions = 0, pendingConfirms = 0, declinedCount = 0;
  upcoming.forEach(({s}) => {
    const f = fillCounts(s);
    openPositions += f.open;
    pendingConfirms += s.crew.filter(c=>!c.confirmed && !c.declined).length;
    declinedCount += f.declined;
  });

  const stat = (label, value, color, screen) => (
    <div onClick={screen?()=>setScreen(screen):undefined} style={{
      ...card({textAlign:"center",padding:"12px 8px"}),
      cursor: screen?"pointer":"default", flex:1,
    }}>
      <div style={{fontSize:"22px",fontWeight:"700",color,lineHeight:1}}>{value}</div>
      <div style={{fontSize:"8px",color:C.muted,letterSpacing:"0.1em",marginTop:"4px"}}>{label}</div>
    </div>
  );

  return (
    <div style={{marginBottom:"12px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"10px"}}>
        <span style={lbl}>⚙ Weekly Operations</span>
        <button onClick={()=>setScreen("newshift")} style={{...btn("gold"),padding:"6px 12px",fontSize:"10px"}}>+ NEW SHIFT</button>
      </div>

      {/* Stat row */}
      <div style={{display:"flex",gap:"8px",marginBottom:"10px"}}>
        {stat("UPCOMING", thisWeek.length, C.gold, "weekgrid")}
        {stat("OPEN POS.", openPositions, openPositions>0?"#F97316":C.green)}
        {stat("PENDING", pendingConfirms, pendingConfirms>0?C.gold:C.green)}
        {stat("DECLINED", declinedCount, declinedCount>0?C.red:C.green)}
      </div>

      {/* Alerts */}
      {(openPositions>0 || declinedCount>0) && (
        <div style={{...card({background:C.goldBg,border:`1px solid ${C.goldDim}`,marginBottom:"10px"})}}>
          <div style={{fontSize:"10px",color:C.gold,fontWeight:"700",letterSpacing:"0.08em",marginBottom:"4px"}}>⚠️ NEEDS ATTENTION</div>
          <div style={{fontSize:"11px",color:C.text,lineHeight:"1.5"}}>
            {openPositions>0 && <div>· {openPositions} open position{openPositions>1?"s":""} still unfilled</div>}
            {declinedCount>0 && <div>· {declinedCount} crew declined — needs a replacement</div>}
            {pendingConfirms>0 && <div>· {pendingConfirms} confirmation{pendingConfirms>1?"s":""} still pending</div>}
          </div>
        </div>
      )}

      {/* Upcoming shifts list */}
      <span style={lbl}>📋 Upcoming Shifts</span>
      <div style={{display:"flex",flexDirection:"column",gap:"8px",marginTop:"8px"}}>
        {upcoming.length===0 && (
          <div style={{textAlign:"center",color:C.muted,fontSize:"12px",padding:"20px",border:`1px dashed ${C.border}`,borderRadius:"8px"}}>
            No upcoming shifts. Tap "+ New Shift" to create one.
          </div>
        )}
        {upcoming.slice(0,6).map(({s, start}) => {
          const f = fillCounts(s);
          const status = deriveShiftStatus(s, now);
          return (
            <div key={s.id} onClick={()=>{setActiveShiftId(s.id);setScreen("shift");}}
              style={{...card({padding:"12px"}),cursor:"pointer"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"8px"}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:"14px",fontWeight:"700",color:C.text}}>{s.client}</div>
                  <div style={{fontSize:"10px",color:C.muted,marginTop:"2px"}}>{s.date} · {s.callTime}–{s.endTime||"?"}{shiftScheduledHours(s)!=null?` · ${shiftScheduledHours(s)}h`:""} · {s.location}</div>
                </div>
                <span style={{color:C.dim,fontSize:"16px"}}>›</span>
              </div>
              <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
                <StatusBadge status={status} size="sm"/>
                <FillBadge shift={s} size="sm"/>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Compact 7-day week strip for the dashboard (no nested page body, no giant grid)
function WeekStrip({state, currentUser, setScreen, setActiveShiftId}) {
  const [offset, setOffset] = useState(0); // weeks from current
  const isManager = currentUser.role==="manager";
  const base = getWeekStart(new Date());
  base.setDate(base.getDate() + offset*7);
  const days = Array.from({length:7}, (_,i)=>{ const d=new Date(base); d.setDate(d.getDate()+i); return d; });
  const today = new Date(); today.setHours(0,0,0,0);

  function shiftsOn(date) {
    return state.shifts.filter(s=>{
      const st = parseShiftStart(s.date, s.callTime);
      if(!st) return false;
      const sameDay = st.getFullYear()===date.getFullYear() && st.getMonth()===date.getMonth() && st.getDate()===date.getDate();
      if(!sameDay) return false;
      if(!isManager) return s.crew.some(c=>c.rosterId===currentUser.id || c.id===currentUser.id);
      return true;
    });
  }

  const rangeLabel = `${days[0].toLocaleDateString([],{month:"short",day:"numeric"})} – ${days[6].toLocaleDateString([],{month:"short",day:"numeric"})}`;

  return (
    <div style={{...card({padding:"12px"})}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"10px"}}>
        <button onClick={()=>setOffset(o=>o-1)} style={{...btn("ghost"),padding:"4px 10px",border:`1px solid ${C.border}`,fontSize:"12px"}}>‹</button>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:"11px",color:C.gold,fontWeight:"700",letterSpacing:"0.08em"}}>{offset===0?"THIS WEEK":rangeLabel.toUpperCase()}</div>
        </div>
        <button onClick={()=>setOffset(o=>o+1)} style={{...btn("ghost"),padding:"4px 10px",border:`1px solid ${C.border}`,fontSize:"12px"}}>›</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"3px"}}>
        {days.map((d,i)=>{
          const isToday = d.getTime()===today.getTime();
          const ds = shiftsOn(d);
          return (
            <div key={i} style={{
              borderRadius:"7px",padding:"6px 2px",minHeight:"64px",
              background: isToday ? C.goldBg : C.s2,
              border:`1px solid ${isToday?C.gold:C.border}`,
              display:"flex",flexDirection:"column",alignItems:"center",gap:"3px",
            }}>
              <div style={{fontSize:"8px",color:C.dim,letterSpacing:"0.05em"}}>{["SUN","MON","TUE","WED","THU","FRI","SAT"][d.getDay()]}</div>
              <div style={{fontSize:"13px",fontWeight:"700",color:isToday?C.gold:C.text}}>{d.getDate()}</div>
              {ds.slice(0,2).map(s=>(
                <div key={s.id} onClick={()=>{setActiveShiftId(s.id);setScreen("shift");}}
                  title={s.client}
                  style={{width:"100%",fontSize:"7px",fontWeight:"700",color:"#1a1400",background:"#E8C84A",borderRadius:"3px",padding:"2px 1px",cursor:"pointer",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",textAlign:"center"}}>
                  {s.client}
                </div>
              ))}
              {ds.length>2 && <div style={{fontSize:"7px",color:C.muted}}>+{ds.length-2}</div>}
            </div>
          );
        })}
      </div>
      <button onClick={()=>setScreen("calendar")} style={{...btn("ghost",true),marginTop:"10px",border:`1px solid ${C.border}`,color:C.muted,fontSize:"10px",padding:"8px"}}>
        OPEN FULL SCHEDULE →
      </button>
    </div>
  );
}

function HomeScreen({state, persist, setScreen, currentUser, setCurrentUser, activeShift, setActiveShiftId}) {
  const isManager = currentUser.role==="manager";
  // Managers see every shift; crew see only the shifts they're assigned to.
  const visibleShifts = isManager
    ? state.shifts
    : state.shifts.filter(s=>s.crew?.some(c=>c.rosterId===currentUser.id||c.id===currentUser.id));
  const confirmed = activeShift?.crew.filter(c=>c.confirmed).length||0;
  const total = activeShift?.crew.length||0;
  const myCrewEntry = activeShift?.crew.find(c=>c.rosterId===currentUser.id||c.id===currentUser.id);

  // Per-device dismissed notification tracking
  const [dismissed, setDismissed] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("bigcrew_dismissed_notifs")||"[]")); }
    catch { return new Set(); }
  });
  function handleDismiss(id) {
    const next = new Set([...dismissed, id]);
    setDismissed(next);
    try { localStorage.setItem("bigcrew_dismissed_notifs", JSON.stringify([...next])); } catch {}
  }

  const myNotifs = state.notifications
    .filter(n => {
      if(dismissed.has(n.id)) return false;
      if(n.to==="all") return true;                       // genuine all-hands broadcast
      if(n.to==="managers") return currentUser.role==="manager"; // crew responses etc.
      if(n.to===currentUser.id) return true;              // addressed to me directly
      if(n.toIds && n.toIds.includes(currentUser.id)) return true; // scoped to a shift's crew
      return false;
    })
    .slice(0, 3);

  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:C.font,color:C.text}}>
      <style>{GS}</style>
      {/* Header */}
      <div style={{background:C.s1,borderBottom:`2px solid ${C.gold}`,padding:"16px 16px 12px",position:"sticky",top:0,zIndex:50}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
            <Logo size={38}/>
            <div>
              <div style={{fontFamily:C.head,fontSize:"22px",letterSpacing:"0.1em",color:C.gold,lineHeight:1}}>BIGCREW NYC</div>
              <div style={{fontSize:"9px",color:C.muted,letterSpacing:"0.16em"}}>
                {isManager?"MANAGER PORTAL":"CREW PORTAL"} · {currentUser.name.split(" ")[0].toUpperCase()}
              </div>
            </div>
          </div>
          <button onClick={()=>{setCurrentUser(null);setScreen("login");}} style={{...btn("ghost"),padding:"6px 10px",fontSize:"10px",border:`1px solid ${C.border}`}}>LOG OUT</button>
        </div>
      </div>

      <div className="bcn-body">
        {/* Notifications */}
        {myNotifs.length>0 && (
          <div style={{marginBottom:"12px"}}>
            {myNotifs.map(n=>(
              <div key={n.id} style={{background:C.goldBg,border:`1px solid ${C.goldDim}`,borderRadius:"8px",padding:"10px 12px",marginBottom:"6px",display:"flex",gap:"10px",alignItems:"flex-start"}}>
                <span style={{fontSize:"16px"}}>📢</span>
                <div style={{flex:1}}>
                  <div style={{fontSize:"11px",color:C.gold,fontWeight:"700",marginBottom:"2px"}}>FROM MANAGEMENT</div>
                  <div style={{fontSize:"12px",color:C.text,lineHeight:"1.4"}}>{n.text}</div>
                  <div style={{fontSize:"9px",color:C.dim,marginTop:"4px"}}>{fmt(n.ts)}</div>
                </div>
                <button onClick={()=>handleDismiss(n.id)} aria-label="Dismiss"
                  style={{background:"none",border:"none",color:C.dim,cursor:"pointer",fontSize:"15px",lineHeight:1,padding:"2px 4px",flexShrink:0}}>✕</button>
              </div>
            ))}
          </div>
        )}

        {/* Manager Weekly Operations Overview (replaces hero unless manager is on the shift) */}
        {isManager && !myCrewEntry && (
          <ManagerOpsOverview state={state} setScreen={setScreen} setActiveShiftId={setActiveShiftId}/>
        )}

        {/* Next Shift Hero — only when the user is personally on this shift */}
        {activeShift && myCrewEntry && (
          <div style={{background:C.goldBg,border:`1.5px solid ${C.gold}`,borderRadius:"12px",padding:"16px",marginBottom:"12px",cursor:"pointer"}}
            onClick={()=>setScreen("shift")}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"10px"}}>
              <div>
                <span style={lbl}>Your Next Shift</span>
                <div style={{fontFamily:C.head,fontSize:"26px",letterSpacing:"0.06em",color:C.gold,lineHeight:1}}>{activeShift.client}</div>
                <div style={{fontSize:"11px",color:C.muted,marginTop:"4px"}}>{activeShift.date} · {activeShift.callTime}–{activeShift.endTime}{shiftScheduledHours(activeShift)!=null?` · ${shiftScheduledHours(activeShift)}h`:""}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:"28px",fontWeight:"700",color:confirmed===total&&total>0?C.green:C.gold}}>{confirmed}/{total}</div>
                <div style={{fontSize:"9px",color:C.muted,letterSpacing:"0.12em"}}>CONFIRMED</div>
              </div>
            </div>
            {/* Status + fill pills */}
            <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"10px"}}>
              <StatusBadge status={deriveShiftStatus(activeShift)}/>
              <FillBadge shift={activeShift}/>
            </div>
            <div style={{background:C.border,borderRadius:"4px",height:"3px",overflow:"hidden",marginBottom:"10px"}}>
              <div style={{height:"100%",background:confirmed===total&&total>0?C.green:"#E8C84A",width:`${total>0?(confirmed/total)*100:0}%`,transition:"width 0.5s ease",borderRadius:"4px"}}/>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:"11px",color:C.muted}}>📍 {activeShift.location} · Tap for details →</div>
              {activeShift.lastUpdated && activeShift.lastUpdated !== activeShift.createdAt && (
                <LastUpdatedBadge timestamp={activeShift.lastUpdated} by={activeShift.updatedBy}/>
              )}
            </div>
            {myCrewEntry && !myCrewEntry.confirmed && !myCrewEntry.declined && (
              <div style={{marginTop:"10px",background:"rgba(232,200,74,0.15)",borderRadius:"6px",padding:"8px 10px",fontSize:"11px",color:C.gold,fontWeight:"700"}}>
                ⚡ YOUR CONFIRMATION IS NEEDED
              </div>
            )}
          </div>
        )}

        {/* Weekly calendar strip */}
        <div style={{marginBottom:"12px"}}>
          {!isManager && <span style={lbl}>📅 Your Week</span>}
          <div style={{marginTop:!isManager?"6px":0}}>
            <WeekStrip state={state} currentUser={currentUser} setScreen={setScreen} setActiveShiftId={setActiveShiftId}/>
          </div>
        </div>

        {/* Quick Nav Grid */}
        <div className="bcn-nav" style={{marginBottom:"12px"}}>
          {[
            {label:"Schedule",icon:"📅",screen:"calendar",color:C.blue},
            {label:"Hours & Pay",icon:"⏱",screen:"hours",color:C.green},
            {label:"Search",icon:"🔍",screen:"search",color:"#06B6D4"},
            ...(isManager?[
              {label:"Crew Roster",icon:"👥",screen:"roster",color:C.purple},
              {label:"Reports",icon:"📊",screen:"reports",color:C.gold},
              {label:"Admin Panel",icon:"🎛️",screen:"admin",color:C.gold},
              {label:"Blast Message",icon:"📨",screen:"message",color:C.red},
            ]:[
              {label:"Expenses & Tax",icon:"💰",screen:"expenses",color:"#F97316"},
            ]),
          ].map(item=>(
            <NavCard key={item.label} {...item} onClick={()=>setScreen(item.screen)}/>
          ))}
        </div>

        {/* All Shifts — managers see every shift; crew see only shifts they're on */}
        <span style={lbl}>{isManager?"All Shifts":"Your Shifts"}</span>
        <div style={{display:"flex",flexDirection:"column",gap:"6px",marginTop:"8px"}}>
          {visibleShifts.map(s=>(
            <div key={s.id} onClick={()=>{setActiveShiftId(s.id);setScreen("shift");}}
              style={{...card({border:`1px solid ${s.id===activeShift?.id?C.gold:C.border}`,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"})}} >
              <div>
                <div style={{fontSize:"13px",fontWeight:"700",color:s.id===activeShift?.id?C.gold:C.text}}>{s.client}</div>
                <div style={{fontSize:"10px",color:C.muted,marginTop:"2px"}}>{s.date} · {s.callTime} · {s.location}</div>
                {isManager && s.crew?.length>0 && (()=>{
                  const conf=s.crew.filter(c=>c.confirmed).length;
                  const dec=s.crew.filter(c=>c.declined).length;
                  const pend=s.crew.length-conf-dec;
                  return (
                    <div style={{fontSize:"10px",marginTop:"3px",display:"flex",gap:"8px",flexWrap:"wrap"}}>
                      <span style={{color:conf===s.crew.length?C.green:C.muted,fontWeight:conf===s.crew.length?"700":"400"}}>✓ {conf}/{s.crew.length} confirmed</span>
                      {dec>0 && <span style={{color:C.red,fontWeight:"700"}}>✗ {dec} declined</span>}
                      {pend>0 && <span style={{color:C.dim}}>{pend} pending</span>}
                    </div>
                  );
                })()}
              </div>
              <span style={badge(s.status==="active"?"#1a1400":C.muted,s.status==="active"?"#E8C84A":C.s3)}>{(s.status||"active").toUpperCase()}</span>
            </div>
          ))}
          {!isManager && visibleShifts.length===0 && (
            <div style={{...card({textAlign:"center",color:C.muted,fontSize:"12px",border:`1px dashed ${C.border}`,padding:"22px 14px"})}}>
              No shifts assigned to you yet.<br/>
              <span style={{fontSize:"11px",color:C.dim}}>They'll show up here once your manager adds you to one.</span>
            </div>
          )}
          {isManager && (
            <button onClick={()=>setScreen("newshift")} style={{...card({background:"transparent",border:`1px dashed ${C.border}`,cursor:"pointer",textAlign:"center",color:C.muted,fontSize:"12px",fontFamily:C.font})}} >
              + Create New Shift
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function NavCard({label,icon,color,onClick}) {
  return (
    <div onClick={onClick} style={{...card({cursor:"pointer",padding:"16px 14px"})}}>
      <div style={{fontSize:"24px",marginBottom:"8px"}}>{icon}</div>
      <div style={{fontSize:"12px",fontWeight:"700",color,letterSpacing:"0.06em"}}>{label}</div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SHIFT SCREEN – crew view of the brief
// ══════════════════════════════════════════════════════════════════════════════
function CCHoursTab({shift, updateShift, currentUser}) {
  const start = parseShiftStart(shift.date, shift.callTime);
  const end = start ? getShiftEnd(start, shift.endTime) : null;
  const scheduledHours = (start && end) ? Math.round(((end - start) / 3600000) * 100) / 100 : 0;

  const [hoursMap, setHoursMap] = useState(() => {
    const m = {};
    shift.crew.filter(c => !c.declined).forEach(c => {
      m[c.id] = Math.round((c.manualHours ?? scheduledHours) * 100) / 100;
    });
    return m;
  });

  function submitHours() {
    updateShift(shift.id, s => ({
      ...s,
      ccHoursSubmitted: true,
      ccSubmittedBy: currentUser.name,
      ccSubmittedAt: now(),
      crew: s.crew.map(c => c.declined ? c : {...c, manualHours: hoursMap[c.id] ?? scheduledHours}),
    }), currentUser.name);
  }

  if (shift.ccHoursSubmitted) {
    return (
      <div style={{textAlign:"center",padding:"36px 20px"}}>
        <div style={{fontSize:"36px",marginBottom:"8px"}}>✅</div>
        <div style={{fontSize:"14px",fontWeight:"700",color:C.green,marginBottom:"4px"}}>Hours Confirmed</div>
        <div style={{fontSize:"11px",color:C.muted}}>By {shift.ccSubmittedBy} · {shift.ccSubmittedAt?fmt(shift.ccSubmittedAt):""}</div>
        <div style={{fontSize:"10px",color:C.dim,marginTop:"8px"}}>Manager can still adjust individual entries if needed. Hours were applied when each crew member confirmed.</div>
      </div>
    );
  }

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
      <div style={card()}>
        <span style={lbl}>Review crew hours · {shift.callTime} – {shift.endTime} · {scheduledHours}h scheduled</span>
        <div style={{fontSize:"11px",color:C.muted,marginBottom:"14px"}}>Hours were applied when each crew member confirmed. Adjust anyone who worked different.</div>
        <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
          {shift.crew.filter(c => !c.declined).map(c => (
            <div key={c.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",
              padding:"10px 12px",background:C.s2,border:`1px solid ${C.border}`,borderRadius:"8px"}}>
              <div>
                <div style={{fontSize:"13px",fontWeight:"700",color:C.text}}>{c.name}</div>
                {c.roleTag&&<div style={{fontSize:"9px",color:C.muted,letterSpacing:"0.1em"}}>{c.roleTag}</div>}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                <input type="number" step="0.5" min="0" max="24"
                  value={hoursMap[c.id] ?? scheduledHours}
                  onChange={e=>setHoursMap(m=>({...m,[c.id]:parseFloat(e.target.value)||0}))}
                  style={{...inp,width:"68px",textAlign:"center",padding:"6px 8px"}}/>
                <span style={{fontSize:"10px",color:C.muted,letterSpacing:"0.08em"}}>HRS</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <button onClick={submitHours} style={{...btn("green",true),padding:"14px",fontSize:"12px",letterSpacing:"0.1em"}}>
        ✓ CONFIRM HOURS
      </button>
    </div>
  );
}

function ShiftScreen({state, persist, updateShift, setScreen, currentUser, activeShift}) {
  const [tab,setTab]=useState("brief");
  const me = activeShift?.crew.find(c=>c.rosterId===currentUser.id||c.id===currentUser.id);
  const isManager = currentUser.role==="manager";
  const isCC = me?.roleTag === "CC";
  const shiftEnded = shiftProgress(activeShift)?.state === "after";

  if(!activeShift) return <div style={{...{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",color:C.muted,fontFamily:C.font}}}>No active shift</div>;

  function confirm() {
    const scheduledHours = shiftScheduledHours(activeShift);
    updateShift(activeShift.id, s => ({
      ...s,
      crew: s.crew.map(c => (c.rosterId===currentUser.id||c.id===currentUser.id)
        ? {...c, confirmed:true, confirmedAt:now(), declined:false, declinedAt:null,
           ...(scheduledHours != null && !c.manualHours ? {manualHours: scheduledHours} : {})} : c),
    }), currentUser.name);
  }
  function decline() {
    updateShift(activeShift.id, s => ({
      ...s,
      crew: s.crew.map(c => (c.rosterId===currentUser.id||c.id===currentUser.id)
        ? {...c, declined:true, declinedAt:now(), confirmed:false, confirmedAt:null} : c),
    }), currentUser.name, [{
      // Declines need a replacement found — tell the managers instead of
      // waiting for one to open the shift and notice.
      id:uid(), to:"managers", shiftId:activeShift.id, ts:now(),
      text:`⚠️ ${currentUser.name} declined ${activeShift.client} · ${activeShift.date}`,
    }]);
  }
  function toggleTask(tid) {
    const tasks = activeShift.tasks.map(t=>t.id===tid?{...t,done:!t.done}:t);
    persist({...state,shifts:state.shifts.map(s=>s.id===activeShift.id?{...s,tasks}:s)});
  }
  function removeShift() {
    if(!window.confirm(`Remove "${activeShift.client}" on ${activeShift.date}? This deletes the shift for everyone.`)) return;
    persist({...state, shifts: state.shifts.filter(s=>s.id!==activeShift.id)});
    setScreen("home");
  }

  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:C.font,color:C.text}}>
      <style>{GS}</style>
      <PageHeader title={activeShift.client} sub={`${activeShift.date} · ${currentUser.name}`} onBack={()=>setScreen("home")}/>

      {/* Manager actions */}
      {isManager && (
        <div style={{background:C.s1,borderBottom:`1px solid ${C.border}`,padding:"8px 14px",display:"flex",justifyContent:"flex-end",gap:"8px"}}>
          <button onClick={removeShift} style={{...btn("ghost"),padding:"7px 12px",fontSize:"10px",border:`1px solid ${C.red}`,color:C.red}}>🗑 REMOVE SHIFT</button>
        </div>
      )}

      {/* Confirmation status bar */}
      {me && (
        <div style={{background:me.confirmed?C.greenBg:C.s1,borderBottom:`1px solid ${C.border}`,padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <span style={lbl}>Shift Status</span>
            <div style={{fontSize:"13px",fontWeight:"700",color:me.confirmed?C.green:me.declined?C.red:C.gold}}>
              {me.confirmed?"CONFIRMED":me.declined?"DECLINED":"AWAITING CONFIRMATION"}
            </div>
          </div>
          {me.confirmed&&(
            <div style={{fontSize:"10px",fontWeight:"700",color:C.green,letterSpacing:"0.08em",
              border:`1px solid ${C.green}`,borderRadius:"5px",padding:"4px 8px"}}>✓ CONFIRMED</div>
          )}
        </div>
      )}

      {/* Tabs — Brief + Tasks always; ⏱ Hours pops in for CC after shift ends */}
      <div style={{display:"flex",gap:"4px",padding:"10px 12px",background:C.s1,borderBottom:`1px solid ${C.border}`}}>
        {[
          {k:"brief", label:"📋 Brief"},
          {k:"tasks", label:"✅ Tasks"},
          ...(isCC && shiftEnded ? [{k:"hours", label:activeShift.ccHoursSubmitted?"⏱ Hours ✓":"⏱ Hours"}] : []),
        ].map(t=>(
          <button key={t.k} onClick={()=>setTab(t.k)} style={{...tabBtn(tab===t.k),
            ...(t.k==="hours"&&activeShift.ccHoursSubmitted&&tab!==t.k?{color:C.green}:{})}}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="bcn-body" style={{paddingBottom:"80px"}}>
        {tab==="brief"&&<BriefTab shift={activeShift} me={me} onConfirm={confirm} onDecline={decline} isManager={isManager} state={state} persist={persist}/>}
        {tab==="tasks"&&<TasksTab shift={activeShift} onToggle={toggleTask} state={state} persist={persist} isManager={isManager}/>}
        {tab==="hours"&&isCC&&shiftEnded&&<CCHoursTab shift={activeShift} updateShift={updateShift} currentUser={currentUser}/>}
      </div>
    </div>
  );
}

function BriefTab({shift,me,onConfirm,onDecline,isManager,state,persist}) {
  const [step,setStep]=useState(false);
  const [msg,setMsg]=useState("");
  const [duration,setDuration]=useState("forever");
  const [, forceRender] = useState(0);
  useEffect(()=>{const t=setInterval(()=>forceRender(n=>n+1),30000);return()=>clearInterval(t);},[]);

  function durationToMs(d){if(d==="1h")return 3600000;if(d==="4h")return 4*3600000;if(d==="24h")return 24*3600000;if(d==="7d")return 7*24*3600000;return null;}
  function postUpdate(){
    if(!msg.trim()) return;
    const expMs=durationToMs(duration);
    const ann={id:uid(),text:msg.trim(),ts:now(),from:"Management",expiresAt:expMs?now()+expMs:null,duration};
    // Scope the alert to the crew on THIS shift, not every crew member in the app.
    const notif={id:uid(),to:"shift",toIds:(shift.crew||[]).map(c=>c.rosterId||c.id),text:msg.trim(),ts:now(),shiftId:shift.id};
    persist({...state,shifts:state.shifts.map(s=>s.id===shift.id?{...s,announcements:[ann,...s.announcements],lastUpdated:now()}:s),notifications:[notif,...state.notifications]});
    setMsg("");setDuration("forever");
  }
  function isExpired(a){return a.expiresAt&&Date.now()>a.expiresAt;}
  function timeLeft(a){if(!a.expiresAt)return null;const ms=a.expiresAt-Date.now();if(ms<=0)return"expired";const h=ms/3600000;if(h<1)return`${Math.ceil(ms/60000)}m left`;if(h<24)return`${Math.ceil(h)}h left`;return`${Math.ceil(h/24)}d left`;}

  const durationOpts=[{key:"1h",label:"1h"},{key:"4h",label:"4h"},{key:"24h",label:"24h"},{key:"7d",label:"7d"},{key:"forever",label:"∞"}];
  const activeAnnouncements = shift.announcements.filter(a=>!isExpired(a));
  return (
    <div style={{display:"flex",flexDirection:"column",gap:"10px",animation:"fadeUp 0.3s ease"}}>
      {/* Status + fill */}
      <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
        <StatusBadge status={deriveShiftStatus(shift)}/>
        <FillBadge shift={shift}/>
      </div>

      {/* Live Timeline */}
      <ShiftTimeline shift={shift}/>

      {/* Last updated badge */}
      {shift.lastUpdated && shift.lastUpdated !== shift.createdAt && (
        <div style={{textAlign:"right",marginTop:"-4px"}}>
          <LastUpdatedBadge timestamp={shift.lastUpdated} by={shift.updatedBy} prominent/>
        </div>
      )}

      {/* Confirm / Decline */}
      {me&&!me.confirmed&&!me.declined&&(
        <div style={{background:C.goldBg,border:`1.5px solid ${C.gold}`,borderRadius:"10px",padding:"14px"}}>
          <div style={{fontSize:"12px",color:C.gold,fontWeight:"700",letterSpacing:"0.1em",marginBottom:"8px"}}>⚡ RESPOND TO THIS SHIFT</div>
          {!step?(
            <div style={{display:"flex",gap:"6px"}}>
              <button onClick={()=>setStep(true)} style={{...btn("gold"),flex:2}}>I'M IN – CONFIRM</button>
              <button onClick={onDecline} style={{...btn("ghost"),flex:1,border:`1px solid ${C.red}`,color:C.red}}>CAN'T MAKE IT</button>
            </div>
          ):(
            <div>
              <div style={{fontSize:"11px",color:C.muted,marginBottom:"10px"}}>By confirming you acknowledge the full brief, call time, and uniform requirements.</div>
              <div style={{display:"flex",gap:"6px"}}>
                <button onClick={()=>{onConfirm();setStep(false);}} style={{...btn("gold"),flex:1}}>✓ CONFIRM</button>
                <button onClick={()=>setStep(false)} style={{...btn("ghost"),flex:1,border:`1px solid ${C.border}`}}>CANCEL</button>
              </div>
            </div>
          )}
        </div>
      )}
      {me?.confirmed&&(
        <div style={{background:C.greenBg,border:`1.5px solid ${C.green}`,borderRadius:"10px",padding:"12px",display:"flex",gap:"10px",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",gap:"10px",alignItems:"center"}}>
            <span style={{fontSize:"20px"}}>✅</span>
            <div><div style={{fontSize:"13px",fontWeight:"700",color:C.green}}>Shift Confirmed</div><div style={{fontSize:"10px",color:C.muted}}>{fmt(me.confirmedAt)}</div></div>
          </div>
          <button onClick={onDecline} style={{...btn("ghost"),padding:"5px 10px",fontSize:"9px",border:`1px solid ${C.border}`,color:C.muted}}>CAN'T MAKE IT</button>
        </div>
      )}
      {me?.declined&&(
        <div style={{background:C.redBg,border:`1.5px solid ${C.red}`,borderRadius:"10px",padding:"12px",display:"flex",gap:"10px",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",gap:"10px",alignItems:"center"}}>
            <span style={{fontSize:"20px"}}>🚫</span>
            <div><div style={{fontSize:"13px",fontWeight:"700",color:C.red}}>You Declined</div><div style={{fontSize:"10px",color:C.muted}}>{fmt(me.declinedAt)} · manager notified</div></div>
          </div>
          <button onClick={onConfirm} style={{...btn("green"),padding:"5px 10px",fontSize:"9px"}}>ACTUALLY, I'M IN</button>
        </div>
      )}
      {/* Notes */}
      <div style={{background:C.goldBg,border:`1px solid ${C.goldDim}`,borderRadius:"10px",padding:"12px",display:"flex",gap:"10px"}}>
        <span style={{fontSize:"18px"}}>⚠️</span>
        <div style={{fontSize:"12px",color:"#d4cfbf",lineHeight:"1.6"}}>{shift.notes}</div>
      </div>
      {/* Details */}
      {[
        {label:"Date",value:shift.date,icon:"📅"},
        {label:"Call Time",value:`${shift.callTime} – ${shift.endTime}${shiftScheduledHours(shift)!=null?` · ${shiftScheduledHours(shift)}h`:""}`,icon:"⏰"},
        {label:"Client",value:shift.client,icon:"🏢"},
        {label:"Point of Contact",value:shift.poc+(shift.pocPhone?` · ${shift.pocPhone}`:""),icon:"📞"},
      ].map(row=>(
        <div key={row.label} style={card()}>
          <span style={lbl}>{row.icon} {row.label}</span>
          <div style={{fontSize:"14px",fontWeight:"600"}}>{row.value}</div>
        </div>
      ))}
      {/* Location */}
      <div style={card()}>
        <span style={lbl}>📍 Location</span>
        <div style={{fontSize:"15px",fontWeight:"700"}}>{shift.location}</div>
        <div style={{fontSize:"11px",color:C.muted,marginTop:"2px"}}>{shift.address}</div>
        <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginTop:"10px",alignItems:"center"}}>
          <a href={`https://maps.google.com/?q=${encodeURIComponent(shift.address)}`} target="_blank" rel="noreferrer"
            style={{display:"inline-block",fontSize:"10px",color:C.gold,textDecoration:"none",border:`1px solid ${C.goldDim}`,borderRadius:"5px",padding:"6px 10px",letterSpacing:"0.1em"}}>
            📍 OPEN IN MAPS →
          </a>
          <CalendarAddMenu shift={shift}/>
        </div>
      </div>
      {/* Scope */}
      <div style={card()}>
        <span style={lbl}>📋 Scope of Work</span>
        {shift.scope.map((item,i)=>(
          <div key={i} style={{display:"flex",gap:"10px",alignItems:"flex-start",marginTop:"8px"}}>
            <div style={{width:"18px",height:"18px",background:C.greenBg,border:`1px solid ${C.green}`,borderRadius:"4px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"10px",color:C.green,flexShrink:0}}>✓</div>
            <div style={{fontSize:"12px",color:"#c8d4c4",lineHeight:"1.5"}}>{item}</div>
          </div>
        ))}
      </div>
      {/* Uniform */}
      <div style={{...card({background:C.s2,border:`1px solid ${C.border}`})}} >
        <span style={lbl}>👕 Uniform</span>
        <div style={{fontSize:"12px",color:"#c8c4d4",lineHeight:"1.6"}}>{shift.uniform}</div>
      </div>
      {/* Crew List */}
      <div style={card()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px"}}>
          <span style={lbl}>👥 Crew ({shift.crew.filter(c=>c.confirmed&&!c.declined).length}/{shift.crew.filter(c=>!c.declined).length})</span>
          <div style={{display:"flex",gap:"4px",alignItems:"center"}}>
            <div style={{fontSize:"10px",color:C.green,fontWeight:"700"}}>{shift.crew.filter(c=>c.confirmed&&!c.declined).length} ✓</div>
            <span style={{color:C.dim,fontSize:"9px"}}>·</span>
            <div style={{fontSize:"10px",color:C.gold}}>{shift.crew.filter(c=>!c.confirmed&&!c.absent&&!c.declined).length} pending</div>
            {shift.crew.filter(c=>c.declined).length>0 && (
              <>
                <span style={{color:C.dim,fontSize:"9px"}}>·</span>
                <div style={{fontSize:"10px",color:C.red}}>{shift.crew.filter(c=>c.declined).length} declined</div>
              </>
            )}
          </div>
        </div>
        {/* Progress bar */}
        <div style={{background:C.s2,borderRadius:"3px",height:"3px",marginBottom:"10px",overflow:"hidden"}}>
          <div style={{height:"100%",background:C.green,width:`${shift.crew.filter(c=>!c.declined).length>0?(shift.crew.filter(c=>c.confirmed&&!c.declined).length/shift.crew.filter(c=>!c.declined).length)*100:0}%`,transition:"width 0.5s ease"}}/>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
          {shift.crew.map((c,i)=>{
            const declined = c.declined;
            const bdr = declined ? C.red : c.absent ? C.red : c.confirmed ? C.green : C.border;
            const bg = declined ? C.redBg : c.absent ? C.redBg : c.confirmed ? C.greenBg : C.s2;
            return (
            <div key={c.id} style={{
              display:"flex",alignItems:"center",gap:"8px",padding:"10px",
              background: bg, borderRadius:"7px", border:`1.5px solid ${bdr}`,
              opacity: declined ? 0.7 : 1,
            }}>
              <div style={{fontSize:"11px",fontWeight:"700",color:C.muted,width:"16px",textAlign:"center"}}>{i+1}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:"13px",fontWeight:"700",color:declined?C.red:c.absent?C.red:c.confirmed?C.green:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",textDecoration:declined?"line-through":"none"}}>
                  {c.name}
                </div>
                {declined && (
                  <div style={{fontSize:"9px",color:C.red,marginTop:"2px"}}>🚫 Declined {c.declinedAt?fmt(c.declinedAt):""}</div>
                )}
                {!declined && c.confirmed && c.confirmedAt && (
                  <div style={{fontSize:"9px",color:C.green,marginTop:"2px"}}>✅ Confirmed {fmt(c.confirmedAt)}</div>
                )}
                {!declined && !c.confirmed && !c.absent && (
                  <div style={{fontSize:"9px",color:C.muted,marginTop:"2px"}}>⏳ Awaiting confirmation</div>
                )}
                {!declined && c.absent && (
                  <div style={{fontSize:"9px",color:C.red,marginTop:"2px"}}>❌ Marked absent</div>
                )}
              </div>
              <div style={{display:"flex",gap:"4px",flexWrap:"wrap",justifyContent:"flex-end"}}>
                {c.role==="Supervisor"&&<span style={badge(C.gold,C.goldBg)}>SUP</span>}
                {c.roleTag && (() => {
                  const tag = [...DEFAULT_ROLE_TAGS, ...((state.customRoleTags)||[])].find(t=>t.code===c.roleTag);
                  const color = tag?.color || C.blue;
                  return <span style={badge(color, "transparent")}>{c.roleTag}</span>;
                })()}
                {declined?<span style={badge(C.red,C.redBg)}>🚫 DECLINED</span>:c.confirmed?<span style={badge(C.green,C.greenBg)}>✓ CONFIRMED</span>:c.absent?null:<span style={badge(C.muted,C.s3)}>PENDING</span>}
              </div>
            </div>
            );
          })}
        </div>
      </div>

      {/* Management Updates — shown to all crew inside Brief */}
      {(activeAnnouncements.length > 0 || isManager) && (
        <div>
          <span style={lbl}>📢 Management Updates</span>

          {isManager && (
            <div style={{...card({marginBottom:"10px"})}}>
              <textarea value={msg} onChange={e=>setMsg(e.target.value)} placeholder="Post a quick update to crew..."
                style={{...inp,minHeight:"70px",resize:"vertical",marginBottom:"8px"}}/>
              <div style={{display:"flex",alignItems:"center",gap:"6px",marginBottom:"10px",flexWrap:"wrap"}}>
                <span style={{fontSize:"10px",color:C.muted,letterSpacing:"0.1em"}}>EXPIRES IN:</span>
                {durationOpts.map(o=>(
                  <button key={o.key} onClick={()=>setDuration(o.key)} style={{
                    padding:"5px 10px",fontSize:"10px",fontWeight:"700",
                    background:duration===o.key?"#E8C84A":"transparent",
                    color:duration===o.key?"#1a1400":C.gold,
                    border:`1px solid ${C.gold}`,borderRadius:"5px",cursor:"pointer",fontFamily:C.font,
                  }}>{o.label}</button>
                ))}
              </div>
              <button onClick={postUpdate} disabled={!msg.trim()} style={{...btn("gold",true),opacity:msg.trim()?1:0.5}}>📢 POST UPDATE</button>
            </div>
          )}

          {activeAnnouncements.length===0 && isManager && (
            <div style={{textAlign:"center",color:C.muted,fontSize:"11px",padding:"10px 0"}}>No updates posted yet</div>
          )}
          <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
            {activeAnnouncements.map(a=>(
              <div key={a.id} style={{...card({background:C.goldBg,border:`1px solid ${C.goldDim}`})}}>
                <div style={{fontSize:"10px",color:C.gold,fontWeight:"700",letterSpacing:"0.1em",marginBottom:"4px"}}>
                  FROM MANAGEMENT {timeLeft(a)?`· ${timeLeft(a)}`:""}
                </div>
                <div style={{fontSize:"12px",color:C.text,lineHeight:"1.5"}}>{a.text}</div>
                <div style={{fontSize:"9px",color:C.dim,marginTop:"4px"}}>{fmt(a.ts)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TasksTab({shift,onToggle,state,persist,isManager}) {
  const [newTask,setNewTask]=useState("");
  const done = shift.tasks.filter(t=>t.done).length;

  function addTask() {
    if(!newTask.trim()) return;
    const t = {id:uid(),text:newTask.trim(),done:false,addedAt:now()};
    persist({...state,shifts:state.shifts.map(s=>s.id===shift.id?{...s,tasks:[...s.tasks,t]}:s)});
    setNewTask("");
  }

  return (
    <div style={{animation:"fadeUp 0.3s ease"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"10px"}}>
        <span style={lbl}>Progress</span>
        <div style={{fontSize:"13px",fontWeight:"700",color:done===shift.tasks.length&&shift.tasks.length>0?C.green:C.gold}}>{done}/{shift.tasks.length}</div>
      </div>
      <div style={{background:C.border,borderRadius:"4px",height:"3px",marginBottom:"14px",overflow:"hidden"}}>
        <div style={{height:"100%",background:done===shift.tasks.length&&shift.tasks.length>0?C.green:"#E8C84A",width:`${shift.tasks.length>0?(done/shift.tasks.length)*100:0}%`,transition:"width 0.4s ease",borderRadius:"4px"}}/>
      </div>

      {/* Scope as tasks */}
      <span style={{...lbl,marginBottom:"8px"}}>Scope Tasks</span>
      <div style={{display:"flex",flexDirection:"column",gap:"6px",marginBottom:"14px"}}>
        {shift.scope.map((item,i)=>{
          const task = shift.tasks.find(t=>t.text===item);
          return (
            <div key={i} onClick={()=>{
              if(task){onToggle(task.id);}
              else{const t={id:uid(),text:item,done:true,addedAt:now()};persist({...state,shifts:state.shifts.map(s=>s.id===shift.id?{...s,tasks:[...s.tasks,t]}:s)});}
            }} style={{...card({display:"flex",alignItems:"center",gap:"10px",cursor:"pointer",background:task?.done?C.greenBg:C.s1,border:`1px solid ${task?.done?C.green:C.border}`})}} >
              <div style={{width:"20px",height:"20px",borderRadius:"4px",background:task?.done?C.green:C.s2,border:`1.5px solid ${task?.done?C.green:C.borderHi}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"11px",color:"#000",flexShrink:0}}>{task?.done?"✓":""}</div>
              <div style={{fontSize:"12px",color:task?.done?C.green:C.text,textDecoration:task?.done?"line-through":"none"}}>{item}</div>
            </div>
          );
        })}
      </div>

      {isManager&&(
        <div>
          <span style={lbl}>Add Custom Task</span>
          <div style={{display:"flex",gap:"6px",marginTop:"6px"}}>
            <input value={newTask} onChange={e=>setNewTask(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addTask()} placeholder="New task..." style={{...inp,flex:1}}/>
            <button onClick={addTask} style={{...btn("gold"),padding:"10px 14px"}}>+</button>
          </div>
        </div>
      )}

      {shift.tasks.filter(t=>!shift.scope.includes(t.text)).length>0&&(
        <div style={{marginTop:"14px"}}>
          <span style={lbl}>Custom Tasks</span>
          <div style={{display:"flex",flexDirection:"column",gap:"6px",marginTop:"8px"}}>
            {shift.tasks.filter(t=>!shift.scope.includes(t.text)).map(t=>(
              <div key={t.id} onClick={()=>onToggle(t.id)}
                style={{...card({display:"flex",alignItems:"center",gap:"10px",cursor:"pointer",background:t.done?C.greenBg:C.s1,border:`1px solid ${t.done?C.green:C.border}`})}}>
                <div style={{width:"20px",height:"20px",borderRadius:"4px",background:t.done?C.green:C.s2,border:`1.5px solid ${t.done?C.green:C.borderHi}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"11px",color:"#000",flexShrink:0}}>{t.done?"✓":""}</div>
                <div style={{fontSize:"12px",color:t.done?C.green:C.text,flex:1,textDecoration:t.done?"line-through":"none"}}>{t.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// CALENDAR
// ══════════════════════════════════════════════════════════════════════════════
function CalendarScreen({state,persist,setScreen,currentUser,activeShift,setActiveShiftId,embedded}) {
  const today = new Date();
  const [year,setYear]=useState(today.getFullYear());
  const [month,setMonth]=useState(today.getMonth());
  const [selected,setSelected]=useState(null);

  const daysInMonth = new Date(year,month+1,0).getDate();
  const firstDay = new Date(year,month,1).getDay();
  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  // Managers see every shift; crew only see shifts they're assigned to.
  const isManager = currentUser.role==="manager";
  const visibleShifts = isManager
    ? state.shifts
    : state.shifts.filter(s=>s.crew?.some(c=>c.rosterId===currentUser.id||c.id===currentUser.id));

  function getShiftsForDay(d) {
    return visibleShifts.filter(s=>{
      const parts = s.date.split("/");
      if(parts.length<3) return false;
      return parseInt(parts[0])===month+1 && parseInt(parts[1])===d && parts[2]===String(year);
    });
  }

  // Get availability for a day. Managers see the whole roster's; crew see
  // only their own — coworkers' schedules are the manager's data.
  function getAvailability(d) {
    const dateStr = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const visible = isManager ? state.roster
      : state.roster.filter(m => m.id===currentUser.id || m.userId===currentUser.id);
    const entries = visible.map(m=>({name:m.name,status:(state.availability[m.id]||{})[dateStr]||null})).filter(e=>e.status);
    return entries;
  }

  const selectedShifts = selected?getShiftsForDay(selected):[];
  const selectedAvail = selected?getAvailability(selected):[];

  return (
    <div style={embedded?{}:{minHeight:"100vh",background:C.bg,fontFamily:C.font,color:C.text}}>

      <div className="bcn-body" style={{paddingBottom:"80px"}}>
        {/* Month nav */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"14px"}}>
          <button onClick={()=>{if(month===0){setMonth(11);setYear(y=>y-1);}else setMonth(m=>m-1);}} style={{...btn("ghost"),padding:"7px 14px",border:`1px solid ${C.border}`}}>‹</button>
          <div style={{fontFamily:C.head,fontSize:"22px",letterSpacing:"0.08em",color:C.gold}}>{monthNames[month].toUpperCase()} {year}</div>
          <button onClick={()=>{if(month===11){setMonth(0);setYear(y=>y+1);}else setMonth(m=>m+1);}} style={{...btn("ghost"),padding:"7px 14px",border:`1px solid ${C.border}`}}>›</button>
        </div>

        {/* Day labels */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"2px",marginBottom:"4px"}}>
          {["S","M","T","W","T","F","S"].map((d,i)=>(
            <div key={i} style={{textAlign:"center",fontSize:"9px",color:C.dim,letterSpacing:"0.1em",padding:"4px 0"}}>{d}</div>
          ))}
        </div>

        {/* Calendar grid */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"3px"}}>
          {Array.from({length:firstDay}).map((_,i)=><div key={`e${i}`}/>)}
          {Array.from({length:daysInMonth}).map((_,i)=>{
            const d=i+1;
            const shifts=getShiftsForDay(d);
            const avail=getAvailability(d);
            const isToday=today.getDate()===d&&today.getMonth()===month&&today.getFullYear()===year;
            const isSel=selected===d;
            const available=avail.filter(a=>a.status==="available").length;
            const unavailable=avail.filter(a=>a.status==="unavailable").length;
            return (
              <div key={d} onClick={()=>setSelected(isSel?null:d)}
                style={{borderRadius:"8px",padding:"6px 4px",minHeight:"52px",textAlign:"center",cursor:"pointer",background:isSel?C.goldBg:isToday?C.s3:C.s1,border:`1px solid ${isSel?C.gold:isToday?C.borderHi:C.border}`,position:"relative"}}>
                <div style={{fontSize:"13px",fontWeight:isToday?"700":"400",color:isSel?C.gold:isToday?C.text:C.muted}}>{d}</div>
                {shifts.length>0&&<div style={{marginTop:"2px",display:"flex",justifyContent:"center",gap:"2px",flexWrap:"wrap"}}>
                  {shifts.map(s=><div key={s.id} style={{width:"6px",height:"6px",borderRadius:"50%",background:"#E8C84A"}}/>)}
                </div>}
                {available>0&&<div style={{position:"absolute",bottom:"3px",left:"3px",width:"5px",height:"5px",borderRadius:"50%",background:C.green}}/>}
                {unavailable>0&&<div style={{position:"absolute",bottom:"3px",right:"3px",width:"5px",height:"5px",borderRadius:"50%",background:C.red}}/>}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div style={{display:"flex",gap:"14px",marginTop:"10px",flexWrap:"wrap"}}>
          {[{color:C.gold,label:"Shift"},{color:C.green,label:"Available"},{color:C.red,label:"Unavailable"}].map(l=>(
            <div key={l.label} style={{display:"flex",alignItems:"center",gap:"5px"}}>
              <div style={{width:"8px",height:"8px",borderRadius:"50%",background:l.color}}/>
              <span style={{fontSize:"10px",color:C.muted}}>{l.label}</span>
            </div>
          ))}
        </div>

        {/* Selected day detail */}
        {selected&&(
          <div style={{marginTop:"16px"}}>
            <div style={{fontFamily:C.head,fontSize:"18px",letterSpacing:"0.06em",color:C.gold,marginBottom:"10px"}}>
              {monthNames[month].toUpperCase()} {selected}, {year}
            </div>
            {selectedShifts.length>0&&(
              <div style={{marginBottom:"12px"}}>
                <span style={lbl}>Shifts</span>
                {selectedShifts.map(s=>(
                  <div key={s.id} onClick={()=>{setActiveShiftId(s.id);setScreen("shift");}}
                    style={{...card({border:`1px solid ${C.gold}`,cursor:"pointer",marginTop:"6px"})}}>
                    <div style={{fontSize:"14px",fontWeight:"700",color:C.gold}}>{s.client}</div>
                    <div style={{fontSize:"11px",color:C.muted,marginTop:"2px"}}>{s.callTime}–{s.endTime} · {s.location}</div>
                    <div style={{fontSize:"11px",color:C.text,marginTop:"4px"}}>{s.crew.length} crew · {s.crew.filter(c=>c.confirmed).length} confirmed</div>
                  </div>
                ))}
              </div>
            )}
            {selectedShifts.length===0&&<div style={{...card({textAlign:"center",color:C.muted,fontSize:"12px",padding:"20px"})}}>No shifts this day</div>}
            {selectedAvail.length>0&&(
              <div>
                <span style={lbl}>Crew Availability</span>
                <div style={{display:"flex",flexDirection:"column",gap:"5px",marginTop:"6px"}}>
                  {selectedAvail.map((a,i)=>(
                    <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 10px",background:C.s1,borderRadius:"7px",border:`1px solid ${C.border}`}}>
                      <span style={{fontSize:"12px",color:C.text}}>{a.name}</span>
                      <span style={badge(a.status==="available"?C.green:a.status==="tentative"?C.gold:C.red,a.status==="available"?C.greenBg:a.status==="tentative"?C.goldBg:C.redBg)}>
                        {(a.status||"").toUpperCase()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MY HOURS – 1099 tracker
// ══════════════════════════════════════════════════════════════════════════════
function HoursScreen({state,persist,updateShift,setScreen,currentUser,activeShift}) {
  const isManager = currentUser.role==="manager";
  const [adjustingMember, setAdjustingMember] = useState(null);
  const [adjustingShift, setAdjustingShift] = useState(null);

  function getMyEntries() {
    return state.shifts.flatMap(s =>
      s.crew
        .filter(c => (c.rosterId===currentUser.id || c.id===currentUser.id) && c.confirmed && !c.declined)
        .map(c => ({shift: s, crew: c, hours: calcHours(c.clockIn, c.clockOut, c.manualHours)}))
    );
  }

  function getAllCrewHours() {
    const map = {};
    state.shifts.forEach(s => {
      s.crew.forEach(c => {
        const h = calcHours(c.clockIn, c.clockOut, c.manualHours);
        if (h.total <= 0 && !c.manualHours) return;
        const key = c.rosterId || c.id;
        if (!map[key]) map[key] = {name:c.name, regular:0, ot:0, total:0, shifts:[]};
        map[key].regular += h.regular;
        map[key].ot += h.ot;
        map[key].total += h.total;
        map[key].shifts.push({shiftId:s.id, date:s.date, client:s.client, crewId:c.id, member:c, ...h});
      });
    });
    return Object.values(map);
  }

  function saveManualHours(shiftId, crewMemberId, hours, reason) {
    updateShift(shiftId, oldShift => ({
      ...oldShift,
      crew: oldShift.crew.map(c => c.id === crewMemberId
        ? {...c, manualHours: hours, adjustReason: reason || c.adjustReason || ""}
        : c),
    }), currentUser.name);
  }

  const myEntries = isManager ? [] : getMyEntries();
  const allCrew = isManager ? getAllCrewHours() : [];
  const myTotal = myEntries.reduce((a,e) => ({
    regular: a.regular + e.hours.regular,
    ot: a.ot + e.hours.ot,
    total: a.total + e.hours.total,
  }), {regular:0, ot:0, total:0});

  // Sort entries by date desc
  myEntries.sort((a,b) => {
    const da = parseShiftStart(a.shift.date, a.shift.callTime);
    const db = parseShiftStart(b.shift.date, b.shift.callTime);
    return (db?.getTime()||0) - (da?.getTime()||0);
  });

  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:C.font,color:C.text}}>
      <style>{GS}</style>
      <PageHeader title={isManager?"Crew Hours (1099)":"My Hours"} sub={isManager?"All Crew · 1099-NEC":"Your Time Records"} onBack={()=>setScreen("home")}/>
      <SectionTabs current="hours" setScreen={setScreen} tabs={[{label:"⏱ Hours",screen:"hours"},{label:"💰 Expenses & Tax",screen:"expenses"}]}/>

      <div className="bcn-body" style={{paddingBottom:"80px",animation:"fadeUp 0.3s ease"}}>
        {!isManager && (
          <>
            {/* Summary cards */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"8px",marginBottom:"16px"}}>
              {[
                {label:"Total Hours",value:fmtHours(myTotal.total),color:C.gold},
                {label:"Regular",value:fmtHours(myTotal.regular),color:C.green},
                {label:"Overtime",value:fmtHours(myTotal.ot),color:"#F97316"},
              ].map(s => (
                <div key={s.label} style={{...card({textAlign:"center",padding:"12px 8px"})}}>
                  <div style={{fontSize:"15px",fontWeight:"700",color:s.color}}>{s.value}</div>
                  <div style={{fontSize:"8px",color:C.muted,letterSpacing:"0.12em",marginTop:"3px"}}>{s.label.toUpperCase()}</div>
                </div>
              ))}
            </div>

            <div style={{...card({background:C.goldBg,border:`1px solid ${C.goldDim}`,marginBottom:"14px"})}}>
              <span style={lbl}>1099-NEC Note</span>
              <div style={{fontSize:"11px",color:C.text,lineHeight:"1.6"}}>
                You're an independent contractor — you track your own income. Save this record for tax purposes.
              </div>
            </div>

            {/* Shift log with adjust button */}
            <span style={lbl}>📋 Shift Log ({myEntries.length} shifts)</span>
            <div style={{display:"flex",flexDirection:"column",gap:"8px",marginTop:"8px"}}>
              {myEntries.length===0 && (
                <div style={{textAlign:"center",color:C.muted,fontSize:"12px",padding:"24px"}}>
                  No shifts yet. They'll show up here once you're added to one.
                </div>
              )}
              {myEntries.map((e,i) => {
                const status = e.crew.clockOut ? "completed" : e.crew.clockIn ? "active" : e.crew.confirmed ? "upcoming" : "pending";
                const statusColor = status==="completed" ? C.green : status==="active" ? C.gold : status==="upcoming" ? C.blue : C.muted;
                const statusText = status==="completed" ? "DONE" : status==="active" ? "ON SITE" : status==="upcoming" ? "UPCOMING" : "PENDING";
                return (
                  <div key={i} style={{...card()}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"6px"}}>
                      <div style={{flex:1}}>
                        <div style={{display:"flex",alignItems:"center",gap:"6px",marginBottom:"3px"}}>
                          <span style={{fontSize:"13px",fontWeight:"700",color:C.text}}>{e.shift.client}</span>
                          <span style={{...badge(statusColor,"transparent"),fontSize:"8px"}}>{statusText}</span>
                        </div>
                        <div style={{fontSize:"10px",color:C.muted}}>{e.shift.date} · {e.shift.location}</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontSize:"15px",fontWeight:"700",color:e.hours.adjusted?C.gold:C.text}}>{fmtHours(e.hours.total)}</div>
                        {e.hours.ot > 0 && <div style={{fontSize:"9px",color:"#F97316",marginTop:"2px"}}>+{fmtHours(e.hours.ot)} OT</div>}
                        {e.hours.adjusted && <div style={{fontSize:"8px",color:C.gold,marginTop:"2px",letterSpacing:"0.08em"}}>ADJUSTED</div>}
                      </div>
                    </div>
                    {(e.crew.clockIn || e.crew.clockOut) && (
                      <div style={{fontSize:"9px",color:C.dim,marginBottom:"6px"}}>
                        {e.crew.clockIn && `In: ${fmt(e.crew.clockIn)}`}{e.crew.clockOut && ` · Out: ${fmt(e.crew.clockOut)}`}
                      </div>
                    )}
                    {e.crew.adjustReason && (
                      <div style={{fontSize:"9px",color:C.gold,marginTop:"4px",fontStyle:"italic"}}>📝 {e.crew.adjustReason}</div>
                    )}
                    <div style={{marginTop:"8px"}}>
                      <button onClick={()=>{setAdjustingMember(e.crew);setAdjustingShift(e.shift);}}
                        style={{...btn("ghost"),padding:"5px 10px",fontSize:"10px",border:`1px solid ${C.border}`,color:C.muted}}>
                        ✏ ADJUST HOURS
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {isManager && (
          <>
            <div style={{...card({background:C.goldBg,border:`1px solid ${C.goldDim}`,marginBottom:"14px"})}}>
              <span style={lbl}>1099-NEC Payroll Reference</span>
              <div style={{fontSize:"11px",color:C.text,lineHeight:"1.6"}}>
                Hours below come from clock in/out records (or manual adjustments). Use for 1099 reference and contractor payment.
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
              {allCrew.length===0 && <div style={{textAlign:"center",color:C.muted,fontSize:"12px",padding:"24px"}}>No hours logged yet.</div>}
              {allCrew.map((c,i) => (
                <div key={i} style={card()}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"10px"}}>
                    <div style={{fontSize:"14px",fontWeight:"700"}}>{c.name}</div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:"16px",fontWeight:"700",color:C.gold}}>{fmtHours(c.total)}</div>
                      {c.ot > 0 && <div style={{fontSize:"10px",color:"#F97316"}}>{fmtHours(c.ot)} OT</div>}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:"6px",marginBottom:"8px"}}>
                    <div style={{flex:1,background:C.s2,borderRadius:"6px",padding:"6px",textAlign:"center"}}>
                      <div style={{fontSize:"11px",fontWeight:"700",color:C.green}}>{fmtHours(c.regular)}</div>
                      <div style={{fontSize:"8px",color:C.muted,letterSpacing:"0.1em"}}>REGULAR</div>
                    </div>
                    <div style={{flex:1,background:C.s2,borderRadius:"6px",padding:"6px",textAlign:"center"}}>
                      <div style={{fontSize:"11px",fontWeight:"700",color:"#F97316"}}>{fmtHours(c.ot)}</div>
                      <div style={{fontSize:"8px",color:C.muted,letterSpacing:"0.1em"}}>OT</div>
                    </div>
                    <div style={{flex:1,background:C.s2,borderRadius:"6px",padding:"6px",textAlign:"center"}}>
                      <div style={{fontSize:"11px",fontWeight:"700",color:C.gold}}>{c.shifts.length}</div>
                      <div style={{fontSize:"8px",color:C.muted,letterSpacing:"0.1em"}}>SHIFTS</div>
                    </div>
                  </div>
                  {c.shifts.map((sh,j) => (
                    <div key={j} style={{fontSize:"10px",color:C.muted,padding:"6px 0",borderTop:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span>{sh.date} · {sh.client}</span>
                      <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
                        <span style={{color:C.text}}>{fmtHours(sh.total)}{sh.ot>0?` (${fmtHours(sh.ot)} OT)`:""}{sh.adjusted?" ✏":""}</span>
                        <button onClick={()=>{
                          const shift = state.shifts.find(s=>s.id===sh.shiftId);
                          setAdjustingMember(sh.member);
                          setAdjustingShift(shift);
                        }} style={{background:"transparent",border:`1px solid ${C.border}`,color:C.muted,borderRadius:"4px",padding:"2px 6px",fontSize:"9px",cursor:"pointer",fontFamily:C.font}}>EDIT</button>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {adjustingMember && adjustingShift && (
        <HoursAdjustModal
          member={adjustingMember}
          shiftClient={adjustingShift.client}
          onSave={(hours, reason) => saveManualHours(adjustingShift.id, adjustingMember.id, hours, reason)}
          onClose={()=>{setAdjustingMember(null);setAdjustingShift(null);}}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// AVAILABILITY
// ══════════════════════════════════════════════════════════════════════════════
function AvailabilityScreen({state,persist,setScreen,currentUser,embedded}) {
  const today = new Date();
  const [year,setYear]=useState(today.getFullYear());
  const [month,setMonth]=useState(today.getMonth());
  const [crewView, setCrewView] = useState("calendar"); // calendar | quick
  const [managerView, setManagerView] = useState("spreadsheet"); // spreadsheet | day
  const [selectedDay, setSelectedDay] = useState(null);
  const [quickText, setQuickText] = useState("");
  const [parsedPreview, setParsedPreview] = useState([]);
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [rangeDate, setRangeDate] = useState("");

  const isManager = currentUser.role === "manager";
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  function dateKey(d) {
    return `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  }

  function getStatus(d, rosterId) {
    const id = rosterId || currentUser.id;
    return (state.availability[id] || {})[dateKey(d)] || null;
  }

  // Cycle: none → available → tentative → unavailable → none
  function cycleStatus(d) {
    const cur = getStatus(d);
    const next = cur === null ? "available"
               : cur === "available" ? "tentative"
               : cur === "tentative" ? "unavailable"
               : null;
    setDayStatus(d, next);
  }

  // status can be: null, "available", "tentative", "unavailable", or {state:"available", start:"3:00 PM", end:"5:00 PM"}
  function setDayStatus(d, status) {
    const id = currentUser.id;
    const cur = state.availability[id] || {};
    const updated = {...cur};
    if (status === null) delete updated[dateKey(d)];
    else updated[dateKey(d)] = status;
    persist({...state, availability:{...state.availability, [id]: updated}});
  }

  function setStatusForDate(dateStr, status) {
    const id = currentUser.id;
    const cur = state.availability[id] || {};
    const updated = {...cur};
    if (status === null) delete updated[dateStr];
    else updated[dateStr] = status;
    persist({...state, availability:{...state.availability, [id]: updated}});
  }

  function statusState(status) {
    if (!status) return null;
    if (typeof status === "string") return status;
    return status.state;
  }
  function statusTimeRange(status) {
    if (status && typeof status === "object" && status.start) {
      return `${status.start}${status.end?"–"+status.end:""}`;
    }
    return null;
  }

  // Live parse as user types
  useEffect(()=>{
    setParsedPreview(parseAvailabilityText(quickText));
  }, [quickText]);

  function applyParsed() {
    // Batch ALL parsed dates into one persist — calling persist per-date in a loop
    // would read stale state each time and only the last date would survive.
    const id = currentUser.id;
    const cur = {...(state.availability[id] || {})};
    parsedPreview.forEach(p => {
      const status = p.start ? {state:p.state, start:p.start, end:p.end} : p.state;
      cur[p.date] = status;
    });
    persist({...state, availability:{...state.availability, [id]: cur}});
    setQuickText("");
    setParsedPreview([]);
  }

  function applyRange() {
    if (!rangeDate || !rangeStart) return;
    setStatusForDate(rangeDate, {state:"available", start:rangeStart, end:rangeEnd});
    setRangeStart("");
    setRangeEnd("");
    setRangeDate("");
  }

  function getAllForDay(d) {
    const ds = dateKey(d);
    return state.roster.map(m => ({
      name: m.name,
      role: m.role,
      rosterId: m.id,
      status: (state.availability[m.id]||{})[ds] || null,
    }));
  }

  // Build spreadsheet rows: [{rosterId, name, days: [{day, status}]}]
  const spreadsheet = state.roster.map(m => ({
    rosterId: m.id,
    name: m.name,
    role: m.role,
    days: Array.from({length:daysInMonth}, (_, i) => ({
      day: i+1,
      status: (state.availability[m.id]||{})[`${year}-${String(month+1).padStart(2,"0")}-${String(i+1).padStart(2,"0")}`] || null,
    })),
  }));

  return (
    <div style={embedded?{}:{minHeight:"100vh",background:C.bg,fontFamily:C.font,color:C.text}}>

      <div className="bcn-body" style={{paddingBottom:"80px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"14px"}}>
          <button onClick={()=>{if(month===0){setMonth(11);setYear(y=>y-1);}else setMonth(m=>m-1);}} style={{...btn("ghost"),padding:"7px 14px",border:`1px solid ${C.border}`}}>‹</button>
          <div style={{fontFamily:C.head,fontSize:"20px",letterSpacing:"0.08em",color:C.gold}}>{monthNames[month].toUpperCase()} {year}</div>
          <button onClick={()=>{if(month===11){setMonth(0);setYear(y=>y+1);}else setMonth(m=>m+1);}} style={{...btn("ghost"),padding:"7px 14px",border:`1px solid ${C.border}`}}>›</button>
        </div>

        {!isManager && (
          <>
            <div style={{...card({background:C.s2,marginBottom:"12px"})}}>
              <div style={{fontSize:"11px",color:C.muted,lineHeight:"1.6"}}>Tap a day to cycle: <b style={{color:C.green}}>Available</b> → <b style={{color:C.gold}}>Tentative</b> → <b style={{color:C.red}}>Unavailable</b> → clear. Add exact hours below.</div>
            </div>
            <>
              <>
                <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"2px",marginBottom:"4px"}}>
                  {["S","M","T","W","T","F","S"].map((d,i)=><div key={i} style={{textAlign:"center",fontSize:"9px",color:C.dim,padding:"4px 0"}}>{d}</div>)}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"3px",marginBottom:"14px"}}>
                  {Array.from({length:firstDay}).map((_,i)=><div key={`e${i}`}/>)}
                  {Array.from({length:daysInMonth}).map((_,i)=>{
                    const d = i+1;
                    const raw = getStatus(d);
                    const status = statusState(raw);
                    const timeRange = statusTimeRange(raw);
                    const isToday = today.getDate()===d && today.getMonth()===month && today.getFullYear()===year;
                    const isPast = new Date(year,month,d) < new Date(today.getFullYear(),today.getMonth(),today.getDate());
                    return (
                      <div key={d} onClick={()=>!isPast && cycleStatus(d)}
                        style={{
                          borderRadius:"7px",padding:"6px 2px",minHeight:"54px",textAlign:"center",cursor:isPast?"default":"pointer",
                          background: status==="available"?C.greenBg : status==="unavailable"?C.redBg : status==="tentative"?C.goldBg : C.s1,
                          border: `1px solid ${status==="available"?C.green : status==="unavailable"?C.red : status==="tentative"?C.gold : isToday?C.borderHi : C.border}`,
                          opacity: isPast ? 0.4 : 1,
                        }}>
                        <div style={{fontSize:"12px",fontWeight:isToday?"700":"400",color:status==="available"?C.green:status==="unavailable"?C.red:status==="tentative"?C.gold:C.muted}}>{d}</div>
                        {status && <div style={{fontSize:"8px",marginTop:"2px",color:status==="available"?C.green:status==="unavailable"?C.red:C.gold}}>{status==="available"?"✓":status==="unavailable"?"✗":"~"}</div>}
                        {timeRange && <div style={{fontSize:"7px",color:C.muted,marginTop:"1px",lineHeight:1}}>{timeRange.replace(/ /g,"")}</div>}
                      </div>
                    );
                  })}
                </div>
                <div style={{display:"flex",gap:"10px",flexWrap:"wrap",marginBottom:"14px"}}>
                  {[{color:C.green,label:"Available"},{color:C.gold,label:"Tentative"},{color:C.red,label:"Unavailable"},{color:C.muted,label:"Not set"}].map(l=>(
                    <div key={l.label} style={{display:"flex",alignItems:"center",gap:"5px"}}>
                      <div style={{width:"8px",height:"8px",borderRadius:"2px",background:l.color}}/>
                      <span style={{fontSize:"10px",color:C.muted}}>{l.label}</span>
                    </div>
                  ))}
                </div>

                {/* Add a specific time range */}
                <div style={{...card({marginBottom:"14px"})}}>
                  <span style={lbl}>🕐 Add exact hours for a day</span>
                  <div style={{display:"flex",flexDirection:"column",gap:"8px",marginTop:"8px"}}>
                    <div>
                      <div style={{fontSize:"9px",color:C.dim,marginBottom:"3px"}}>DATE</div>
                      <input type="date" value={rangeDate} onChange={e=>setRangeDate(e.target.value)} style={{...inp}}/>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
                      <div>
                        <div style={{fontSize:"9px",color:C.dim,marginBottom:"3px"}}>FROM</div>
                        <TimeInput value={rangeStart} onChange={setRangeStart}/>
                      </div>
                      <div>
                        <div style={{fontSize:"9px",color:C.dim,marginBottom:"3px"}}>TO</div>
                        <TimeInput value={rangeEnd} onChange={setRangeEnd}/>
                      </div>
                    </div>
                    <button onClick={applyRange} disabled={!rangeDate||!rangeStart} style={{...btn("green",true),opacity:rangeDate&&rangeStart?1:0.5}}>+ ADD AVAILABILITY</button>
                  </div>
                </div>
              </>
            </>
          </>
        )}

        {isManager && (
          <>
            {/* Manager view toggle */}
            <div style={{display:"flex",gap:"4px",marginBottom:"12px"}}>
              {[{key:"spreadsheet",label:"📊 Spreadsheet"},{key:"day",label:"📅 Day View"}].map(v=>(
                <button key={v.key} onClick={()=>setManagerView(v.key)} style={{
                  flex:1,padding:"8px",fontSize:"11px",fontWeight:"700",letterSpacing:"0.08em",
                  background: managerView===v.key ? "#E8C84A" : "transparent",
                  color: managerView===v.key ? "#1a1400" : C.muted,
                  border: `1px solid ${managerView===v.key ? "#E8C84A" : C.border}`,
                  borderRadius:"6px",cursor:"pointer",fontFamily:C.font,
                }}>{v.label}</button>
              ))}
            </div>

            {managerView === "spreadsheet" && (
              <div style={{...card({padding:"0",overflow:"hidden"})}}>
                {/* Spreadsheet table */}
                <div style={{overflowX:"auto",maxWidth:"100%"}}>
                  <table style={{borderCollapse:"separate",borderSpacing:0,fontSize:"10px",fontFamily:C.font,minWidth:"100%"}}>
                    <thead>
                      <tr>
                        <th style={{position:"sticky",left:0,background:C.s2,borderBottom:`2px solid ${C.gold}`,borderRight:`2px solid ${C.gold}`,padding:"8px 10px",textAlign:"left",fontSize:"9px",color:C.gold,letterSpacing:"0.1em",zIndex:10,minWidth:"100px"}}>CREW</th>
                        {Array.from({length:daysInMonth}).map((_,i)=>{
                          const d = i+1;
                          const date = new Date(year,month,d);
                          const dow = date.getDay();
                          const isToday = today.getDate()===d && today.getMonth()===month && today.getFullYear()===year;
                          return (
                            <th key={d} style={{
                              padding:"6px 0",textAlign:"center",fontSize:"9px",
                              background: isToday ? C.goldBg : (dow===0||dow===6) ? C.s2 : C.s1,
                              color: isToday ? C.gold : C.muted,
                              borderBottom:`2px solid ${C.gold}`,
                              minWidth:"28px",
                              fontWeight: isToday ? "700" : "400",
                            }}>
                              <div>{d}</div>
                              <div style={{fontSize:"7px",opacity:0.6}}>{["S","M","T","W","T","F","S"][dow]}</div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {spreadsheet.map(row => (
                        <tr key={row.rosterId}>
                          <td style={{position:"sticky",left:0,background:C.s1,borderRight:`2px solid ${C.gold}`,padding:"6px 10px",fontWeight:"700",fontSize:"11px",borderBottom:`1px solid ${C.border}`,minWidth:"100px",zIndex:5}}>
                            {row.name.split(" ")[0]}
                            {row.role==="Supervisor" && <span style={{fontSize:"8px",color:C.gold,marginLeft:"4px"}}>SUP</span>}
                          </td>
                          {row.days.map(({day, status}) => {
                            const st = statusState(status);
                            const tr = statusTimeRange(status);
                            const bg = st==="available" ? C.greenBg : st==="unavailable" ? C.redBg : st==="tentative" ? C.goldBg : "transparent";
                            const fg = st==="available" ? C.green : st==="unavailable" ? C.red : st==="tentative" ? C.gold : C.dim;
                            return (
                              <td key={day} title={tr || (st || "no data")}
                                style={{textAlign:"center",padding:"4px 0",background:bg,borderBottom:`1px solid ${C.border}`,color:fg,fontWeight:"700",fontSize:"11px",cursor:"default"}}>
                                {st==="available" ? "✓" : st==="unavailable" ? "✗" : st==="tentative" ? "~" : "·"}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{padding:"10px 14px",fontSize:"9px",color:C.muted,borderTop:`1px solid ${C.border}`,display:"flex",gap:"12px",flexWrap:"wrap"}}>
                  <span><span style={{color:C.green}}>✓</span> Available</span>
                  <span><span style={{color:C.gold}}>~</span> Tentative</span>
                  <span><span style={{color:C.red}}>✗</span> Unavailable</span>
                  <span><span style={{color:C.dim}}>·</span> No response</span>
                </div>
              </div>
            )}

            {managerView === "day" && (
              <>
                <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"2px",marginBottom:"4px"}}>
                  {["S","M","T","W","T","F","S"].map((d,i)=><div key={i} style={{textAlign:"center",fontSize:"9px",color:C.dim,padding:"4px 0"}}>{d}</div>)}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"3px",marginBottom:"14px"}}>
                  {Array.from({length:firstDay}).map((_,i)=><div key={`e${i}`}/>)}
                  {Array.from({length:daysInMonth}).map((_,i)=>{
                    const d = i+1;
                    const all = getAllForDay(d);
                    const available = all.filter(a=>statusState(a.status)==="available").length;
                    const unavailable = all.filter(a=>statusState(a.status)==="unavailable").length;
                    const isToday = today.getDate()===d && today.getMonth()===month && today.getFullYear()===year;
                    const hasShift = state.shifts.some(s=>{const p=s.date.split("/");return parseInt(p[0])===month+1&&parseInt(p[1])===d&&p[2]===String(year);});
                    return (
                      <div key={d} onClick={()=>setSelectedDay(d===selectedDay?null:d)}
                        style={{borderRadius:"7px",padding:"5px 2px",minHeight:"52px",textAlign:"center",cursor:"pointer",
                          background:selectedDay===d?C.goldBg:C.s1,border:`1px solid ${selectedDay===d?C.gold:isToday?C.borderHi:C.border}`}}>
                        <div style={{fontSize:"12px",fontWeight:isToday?"700":"400",color:selectedDay===d?C.gold:C.muted}}>{d}</div>
                        {hasShift && <div style={{width:"5px",height:"5px",borderRadius:"50%",background:"#E8C84A",margin:"2px auto"}}/>}
                        <div style={{fontSize:"8px",color:C.green,marginTop:"1px"}}>{available>0?`${available}✓`:""}</div>
                        <div style={{fontSize:"8px",color:C.red}}>{unavailable>0?`${unavailable}✗`:""}</div>
                      </div>
                    );
                  })}
                </div>
                {selectedDay && (
                  <div style={{animation:"fadeUp 0.3s ease"}}>
                    <div style={{fontFamily:C.head,fontSize:"18px",color:C.gold,letterSpacing:"0.06em",marginBottom:"10px"}}>{monthNames[month].toUpperCase()} {selectedDay}</div>
                    <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
                      {getAllForDay(selectedDay).map((m,i)=>{
                        const st = statusState(m.status);
                        const tr = statusTimeRange(m.status);
                        return (
                          <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 12px",background:C.s1,borderRadius:"8px",border:`1px solid ${C.border}`}}>
                            <div>
                              <div style={{fontSize:"13px",color:C.text}}>{m.name}</div>
                              {tr && <div style={{fontSize:"10px",color:C.muted,marginTop:"2px"}}>🕐 {tr}</div>}
                            </div>
                            <span style={st ? badge(st==="available"?C.green:st==="tentative"?C.gold:C.red, st==="available"?C.greenBg:st==="tentative"?C.goldBg:C.redBg) : badge(C.dim,C.s2)}>
                              {st ? st.toUpperCase() : "NOT SET"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Send weekly reminder button */}
            <div style={{...card({marginTop:"14px",border:`1px solid ${C.blue}`})}}>
              <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                <span style={{fontSize:"22px"}}>📨</span>
                <div style={{flex:1}}>
                  <div style={{fontSize:"12px",fontWeight:"700",color:C.blue}}>Weekly Availability Reminder</div>
                  <div style={{fontSize:"10px",color:C.muted,marginTop:"2px",lineHeight:"1.5"}}>Send all crew a request to update their availability for the upcoming week.</div>
                </div>
              </div>
              <a href={(() => {
                const phones = state.roster.filter(m=>m.phone).map(m=>m.phone).join(",");
                const msg = encodeURIComponent("Hey! Please update your availability for next week in the BigCrew app. Open the app → Availability → set your days. Thanks!");
                return `sms:${phones}?&body=${msg}`;
              })()}
                style={{display:"block",marginTop:"10px",...btn("blue",true),padding:"10px",textDecoration:"none",textAlign:"center"}}>
                💬 SEND REMINDER TO ALL ({state.roster.filter(m=>m.phone).length})
              </a>
              <div style={{fontSize:"9px",color:C.dim,marginTop:"6px",lineHeight:"1.5"}}>
                Opens a group SMS draft. For fully automated weekly auto-sends, you'd need a backend with a scheduler (Twilio + cron).
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// WEEKLY SCHEDULE GRID – visual 7-day × hourly view (managers)
// ══════════════════════════════════════════════════════════════════════════════
function WeekGridScreen({state, setScreen, setActiveShiftId, embedded, currentUser}) {
  const [weekStart, setWeekStart] = useState(getWeekStart(new Date()));

  // Managers see every shift; crew only see shifts they're assigned to.
  const isManager = !currentUser || currentUser.role==="manager";
  const visibleShifts = isManager
    ? state.shifts
    : state.shifts.filter(s=>s.crew?.some(c=>c.rosterId===currentUser.id||c.id===currentUser.id));

  // 7 days starting Monday
  const days = Array.from({length:7}, (_,i)=>{
    const d = new Date(weekStart);
    d.setDate(d.getDate()+i);
    return d;
  });

  const startHour = 6;       // 6 AM
  const totalHours = 21;     // through 2 AM next day (21 rows)
  const rowH = 44;           // pixels per hour row

  // Compute shifts on a given Date (calendar day match)
  function shiftsOn(date) {
    return visibleShifts.filter(s=>{
      const start = parseShiftStart(s.date, s.callTime);
      if(!start) return false;
      return start.getFullYear()===date.getFullYear() &&
             start.getMonth()===date.getMonth() &&
             start.getDate()===date.getDate();
    });
  }

  // Build position for a shift block within its day column
  function shiftPos(shift, dayDate) {
    const start = parseShiftStart(shift.date, shift.callTime);
    const end = start ? getShiftEnd(start, shift.endTime) : null;
    if(!start || !end) return null;
    const startH = start.getHours() + start.getMinutes()/60;
    let durH;
    const sameDay = end.toDateString()===start.toDateString();
    if(sameDay) durH = (end.getHours()+end.getMinutes()/60) - startH;
    else durH = (24 - startH) + (end.getHours()+end.getMinutes()/60); // crosses midnight
    const top = Math.max(0, (startH - startHour) * rowH);
    // Clamp height to grid
    const maxHeight = (totalHours * rowH) - top;
    const height = Math.min(durH * rowH, maxHeight);
    return { top, height };
  }

  // Density per cell — count shifts overlapping that hour on that day
  function densityAt(dayDate, hour) {
    return shiftsOn(dayDate).filter(s=>{
      const start = parseShiftStart(s.date, s.callTime);
      const end = start ? getShiftEnd(start, s.endTime) : null;
      if(!start||!end) return false;
      const startH = start.getHours();
      const endH = end.toDateString()===start.toDateString() ? end.getHours() : 24;
      return hour >= startH && hour < endH;
    }).length;
  }

  // Client → color
  const palette = ["#E8C84A", "#4ade80", "#60a5fa", "#c084fc", "#fb923c", "#f472b6", "#22d3ee"];
  const clientColor = (client) => {
    let h = 0;
    for(let i=0;i<client.length;i++) h = (h*31 + client.charCodeAt(i)) >>> 0;
    return palette[h % palette.length];
  };

  function gotoShift(s) {
    setActiveShiftId(s.id);
    setScreen("shift");
  }

  const todayKey = new Date().toDateString();
  const totalShiftsThisWeek = days.reduce((a,d)=>a+shiftsOn(d).length, 0);
  const totalCrewBookings = days.reduce((a,d)=>a + shiftsOn(d).reduce((b,s)=>b+s.crew.length,0), 0);

  function jumpToToday() { setWeekStart(getWeekStart(new Date())); }

  return (
    <div style={embedded?{}:{minHeight:"100vh",background:C.bg,fontFamily:C.font,color:C.text}}>

      <div className="bcn-body">
        {/* Week nav */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"12px",flexWrap:"wrap",gap:"8px"}}>
          <button onClick={()=>setWeekStart(prev=>{const d=new Date(prev);d.setDate(d.getDate()-7);return d;})}
            style={{...btn("ghost"),padding:"7px 12px",fontSize:"11px",border:`1px solid ${C.border}`}}>‹ Prev Week</button>
          <div style={{textAlign:"center"}}>
            <div style={{fontFamily:C.head,fontSize:"22px",letterSpacing:"0.08em",color:C.gold,lineHeight:1}}>
              {weekStart.toLocaleDateString("en-US",{month:"short",day:"numeric"})} – {days[6].toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
            </div>
            <button onClick={jumpToToday} style={{fontSize:"10px",background:"none",border:"none",color:C.muted,cursor:"pointer",letterSpacing:"0.1em",marginTop:"2px"}}>JUMP TO TODAY</button>
          </div>
          <button onClick={()=>setWeekStart(prev=>{const d=new Date(prev);d.setDate(d.getDate()+7);return d;})}
            style={{...btn("ghost"),padding:"7px 12px",fontSize:"11px",border:`1px solid ${C.border}`}}>Next Week ›</button>
        </div>

        {/* Stats */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"8px",marginBottom:"14px"}}>
          {[
            {label:"Shifts",value:totalShiftsThisWeek,color:C.gold,icon:"📅"},
            {label:"Crew Bookings",value:totalCrewBookings,color:C.green,icon:"👥"},
            {label:"Days w/ Work",value:days.filter(d=>shiftsOn(d).length>0).length,color:C.blue,icon:"⚡"},
          ].map(s=>(
            <div key={s.label} style={{...card({textAlign:"center",padding:"10px 6px"})}}>
              <div style={{fontSize:"18px",marginBottom:"2px"}}>{s.icon}</div>
              <div style={{fontSize:"18px",fontWeight:"700",color:s.color}}>{s.value}</div>
              <div style={{fontSize:"8px",color:C.muted,letterSpacing:"0.12em",marginTop:"2px"}}>{s.label.toUpperCase()}</div>
            </div>
          ))}
        </div>

        {/* Grid */}
        <div style={{...card({padding:"0",overflow:"hidden"})}}>
          {/* Day header row */}
          <div style={{display:"grid",gridTemplateColumns:"48px repeat(7, 1fr)",borderBottom:`1px solid ${C.border}`,background:C.s2}}>
            <div style={{padding:"10px 4px",fontSize:"9px",color:C.dim,textAlign:"center",letterSpacing:"0.1em"}}>HR</div>
            {days.map((d,i)=>{
              const isToday = d.toDateString()===todayKey;
              const shiftCount = shiftsOn(d).length;
              return (
                <div key={i} style={{padding:"10px 4px",textAlign:"center",borderLeft:`1px solid ${C.border}`,background:isToday?C.goldBg:"transparent"}}>
                  <div style={{fontSize:"9px",color:isToday?C.gold:C.muted,letterSpacing:"0.12em",fontWeight:"700"}}>
                    {d.toLocaleDateString("en-US",{weekday:"short"}).toUpperCase()}
                  </div>
                  <div style={{fontSize:"14px",fontWeight:"700",color:isToday?C.gold:C.text,marginTop:"2px"}}>{d.getDate()}</div>
                  {shiftCount>0&&<div style={{fontSize:"9px",color:isToday?C.gold:C.muted,marginTop:"2px"}}>{shiftCount}🎬</div>}
                </div>
              );
            })}
          </div>

          {/* Time grid body */}
          <div style={{display:"grid",gridTemplateColumns:"48px repeat(7, 1fr)",position:"relative"}}>
            {/* Hour labels column */}
            <div>
              {Array.from({length:totalHours}, (_,i)=>{
                const h = (startHour + i) % 24;
                return (
                  <div key={i} style={{height:`${rowH}px`,padding:"4px",fontSize:"9px",color:C.dim,textAlign:"right",borderTop:`1px solid ${C.border}`,letterSpacing:"0.04em"}}>
                    {fmtHour12(h)}
                  </div>
                );
              })}
            </div>

            {/* Day columns */}
            {days.map((d,di)=>{
              const isToday = d.toDateString()===todayKey;
              const dayShifts = shiftsOn(d);
              return (
                <div key={di} style={{position:"relative",borderLeft:`1px solid ${C.border}`,background:isToday?"rgba(232,200,74,0.03)":"transparent"}}>
                  {/* Hour cells with density tint */}
                  {Array.from({length:totalHours}, (_,i)=>{
                    const h = (startHour + i) % 24;
                    const density = densityAt(d, h);
                    return (
                      <div key={i} style={{
                        height:`${rowH}px`,
                        borderTop:`1px solid ${C.border}`,
                        background: density===0?"transparent":density===1?"rgba(232,200,74,0.04)":density===2?"rgba(232,200,74,0.10)":"rgba(232,200,74,0.16)",
                      }}/>
                    );
                  })}

                  {/* Shift blocks */}
                  {dayShifts.map((s,si)=>{
                    const pos = shiftPos(s, d);
                    if(!pos) return null;
                    const col = clientColor(s.client);
                    return (
                      <div key={s.id} onClick={()=>gotoShift(s)} style={{
                        position:"absolute",
                        left: `${2 + si*3}px`,
                        right: "2px",
                        top: `${pos.top}px`,
                        height: `${Math.max(pos.height, 28)}px`,
                        background: col,
                        borderRadius: "4px",
                        padding: "4px 6px",
                        cursor: "pointer",
                        overflow: "hidden",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
                        border: `1px solid rgba(0,0,0,0.3)`,
                        zIndex: 2 + si,
                      }}>
                        <div style={{fontSize:"10px",fontWeight:"700",color:"#000",lineHeight:1.2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                          {s.client}
                        </div>
                        <div style={{fontSize:"8px",color:"#000",opacity:0.85,marginTop:"1px",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                          {s.callTime}–{s.endTime}
                        </div>
                        <div style={{fontSize:"8px",color:"#000",opacity:0.75,marginTop:"1px"}}>{s.crew.length} crew · {s.crew.filter(c=>c.confirmed).length}✓</div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div style={{marginTop:"14px",display:"flex",flexWrap:"wrap",gap:"10px",alignItems:"center"}}>
          <span style={{fontSize:"10px",color:C.muted,letterSpacing:"0.1em"}}>DENSITY:</span>
          {[
            {label:"0",bg:"transparent"},
            {label:"1",bg:"rgba(232,200,74,0.10)"},
            {label:"2",bg:"rgba(232,200,74,0.20)"},
            {label:"3+",bg:"rgba(232,200,74,0.30)"},
          ].map(l=>(
            <div key={l.label} style={{display:"flex",alignItems:"center",gap:"4px"}}>
              <div style={{width:"14px",height:"14px",background:l.bg,border:`1px solid ${C.border}`,borderRadius:"2px"}}/>
              <span style={{fontSize:"9px",color:C.muted}}>{l.label}</span>
            </div>
          ))}
          <div style={{marginLeft:"auto",fontSize:"10px",color:C.muted}}>Tap shift block to view</div>
        </div>

        {/* Quick add shift button */}
        <button onClick={()=>setScreen("newshift")} style={{...btn("gold",true),marginTop:"14px",padding:"12px"}}>
          + ADD NEW SHIFT
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MESSAGE SCREEN – Structured editor matching exact BigCrew format
// ══════════════════════════════════════════════════════════════════════════════
// Shown by manager screens that operate on a specific shift, when none exists yet.
function NoShiftEmptyState({title, setScreen}) {
  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:C.font,color:C.text}}>
      <style>{GS}</style>
      <PageHeader title={title} sub="No shift selected" onBack={()=>setScreen("home")}/>
      <div className="bcn-body">
        <div style={{...card({textAlign:"center",padding:"34px 20px"})}}>
          <div style={{fontSize:"34px",marginBottom:"10px"}}>📋</div>
          <div style={{fontSize:"15px",fontWeight:"700",color:C.text,marginBottom:"6px"}}>No shift to work with yet</div>
          <div style={{fontSize:"12px",color:C.muted,lineHeight:"1.6",marginBottom:"20px"}}>
            Create a shift first — then come back here. You can add crew to your roster while building the shift.
          </div>
          <div style={{display:"flex",gap:"8px",justifyContent:"center",flexWrap:"wrap"}}>
            <button onClick={()=>setScreen("newshift")} style={{...btn("gold"),padding:"11px 20px"}}>+ CREATE A SHIFT</button>
            <button onClick={()=>setScreen("home")} style={{...btn("ghost"),padding:"11px 20px",border:`1px solid ${C.border}`}}>← HOME</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Snapshot of the shift fields the blast form can edit — used both to seed the
// form and to detect which fields the manager actually changed (dirty check).
function blastSnapshot(s) {
  return {
    notes: s?.notes || "", date: s?.date || "", callTime: s?.callTime || "",
    endTime: s?.endTime || "", client: s?.client || "", location: s?.location || "",
    address: s?.address || "", poc: s?.poc || "", pocPhone: s?.pocPhone || "",
    uniform: s?.uniform || "", scope: [...(s?.scope || [])],
  };
}

function MessageScreen({state,persist,setScreen,activeShift,setActiveShiftId,currentUser}) {
  // Local form state initialized from active shift
  const [form, setForm] = useState({ ...blastSnapshot(activeShift), extraNotes:"", includeCalLink:true });
  // Mount-time snapshot: on save, only fields that differ from this are
  // written back — so an untouched form can't clobber edits made elsewhere
  // (another manager, another device) while this screen was open.
  const initialFormRef = useRef(blastSnapshot(activeShift));
  const shiftIdRef = useRef(activeShift?.id);
  // Which crew to include in this message
  const [includedCrew, setIncludedCrew] = useState(
    (activeShift?.crew || []).map(c=>c.id)
  );
  // Re-seed everything when the manager picks a different shift (or picks one
  // after arriving here with none selected).
  useEffect(()=>{
    if(activeShift && activeShift.id !== shiftIdRef.current){
      shiftIdRef.current = activeShift.id;
      initialFormRef.current = blastSnapshot(activeShift);
      setForm({ ...blastSnapshot(activeShift), extraNotes:"", includeCalLink:true });
      setIncludedCrew((activeShift.crew||[]).map(c=>c.id));
    }
  },[activeShift]);
  // Extra recipients (not yet on roster)
  const [extraRecipients, setExtraRecipients] = useState([]);
  const [newRecipient, setNewRecipient] = useState({name:"",email:"",phone:""});
  const [copied, setCopied] = useState(false);
  const [showAddCrew, setShowAddCrew] = useState(false);
  const [manualEmails, setManualEmails] = useState("");
  const [savePrompt, setSavePrompt] = useState(null); // person pending "save to roster?" decision
  const [msgMode, setMsgMode] = useState("blast"); // blast | custom
  const [customMsg, setCustomMsg] = useState("");
  const [posted, setPosted] = useState(false);

  if(!activeShift && state.shifts.length===0) return <NoShiftEmptyState title="Blast Message" setScreen={setScreen}/>;
  if(!activeShift) return (
    // Shifts exist but none was explicitly selected — make the manager pick
    // instead of silently defaulting to the first shift in the system (which
    // made it possible to edit and save onto the wrong shift).
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:C.font,color:C.text}}>
      <style>{GS}</style>
      <PageHeader title="Blast Message" sub="Pick the shift to message about" onBack={()=>setScreen("home")}/>
      <div className="bcn-body" style={{paddingTop:"12px",display:"flex",flexDirection:"column",gap:"8px"}}>
        <span style={lbl}>Which shift?</span>
        {state.shifts.map(s=>(
          <div key={s.id} onClick={()=>setActiveShiftId(s.id)}
            style={{...card({cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"})}}>
            <div>
              <div style={{fontSize:"13px",fontWeight:"700"}}>{s.client}</div>
              <div style={{fontSize:"10px",color:C.muted,marginTop:"2px"}}>{s.date} · {s.callTime} · {s.crew?.length||0} crew</div>
            </div>
            <span style={{color:C.gold,fontSize:"16px"}}>→</span>
          </div>
        ))}
      </div>
    </div>
  );

  // Update a scope line
  function updateScope(i, val) {
    setForm(f=>{const s=[...f.scope]; s[i]=val; return {...f,scope:s};});
  }
  function addScopeLine() { setForm(f=>({...f,scope:[...f.scope,""]})); }
  function removeScope(i) { setForm(f=>({...f,scope:f.scope.filter((_,j)=>j!==i)})); }

  // Toggle crew inclusion
  function toggleCrew(id) {
    setIncludedCrew(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]);
  }

  // Add extra recipient → then prompt to save them to the roster (no duplicate entry)
  function addExtraRecipient() {
    if(!newRecipient.name.trim()) return;
    const person = {id:uid(),...newRecipient};
    setExtraRecipients(prev=>[...prev,person]);
    const pending = {...newRecipient};
    setNewRecipient({name:"",email:"",phone:""});
    // Only prompt if they're not already on the roster (by name or email)
    const exists = state.roster.some(m =>
      m.name.toLowerCase()===pending.name.toLowerCase() ||
      (pending.email && m.email && m.email.toLowerCase()===pending.email.toLowerCase())
    );
    if(!exists) setSavePrompt(pending);
  }
  function removeExtra(id) {
    setExtraRecipients(prev=>prev.filter(r=>r.id!==id));
  }
  function saveNewToRoster(form) {
    const member = {id:uid(), name:form.name, role:form.role||"Crew", position:form.role||"Crew",
      phone:form.phone||"", email:form.email||"", pin:form.pin||"0000", available:true, active:true, notes:"", tags:[]};
    persist({...state, roster:[...state.roster, member]});
    setSavePrompt(null);
  }

  // Generate the final message – EXACT BigCrew format
  function buildMessage() {
    if (msgMode === "custom") return customMsg;
    const crewInMsg = (activeShift.crew||[]).filter(c=>includedCrew.includes(c.id));
    const allCrew = [...crewInMsg, ...extraRecipients];
    const crewLines = allCrew.map((c,i)=>{
      const supTag = c.role==="Supervisor" ? " (Sup)" : "";
      const roleTag = c.roleTag ? ` (${c.roleTag})` : "";
      return `${i+1}. ${c.name}${supTag}${roleTag}`;
    }).join("\n");

    let msg = `Please Confirm!!!!\nNotes: ${form.notes}\n\nDate: ${form.date}\n\nCall time: ${form.callTime}${form.endTime?" - "+form.endTime:""}\n\nClient: ${form.client}\n\nLocation / Scope: ${form.location}${form.address?"\n"+form.address:""}`;
    if (form.scope.filter(s=>s.trim()).length) {
      msg += "\n" + form.scope.filter(s=>s.trim()).map(s=>"• "+s).join("\n");
    }
    msg += `\n\nUniform:\n${form.uniform}\n\nPoint of Contact: ${form.poc}${form.pocPhone?" - "+form.pocPhone:""}\n\nCrew:\n${crewLines}`;
    if (form.extraNotes.trim()) msg += `\n\n${form.extraNotes}`;
    return msg;
  }

  const messageText = buildMessage();

  function copyMsg() {
    navigator.clipboard.writeText(messageText).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);});
  }

  // Save changes back to the shift
  function saveToShift() {
    // Write back ONLY the fields the manager actually changed on this screen.
    // A stale untouched form must not revert edits that landed on the shift
    // (from another manager or device) while the blast screen was open.
    const init = initialFormRef.current || {};
    const dirty = {};
    ["notes","date","callTime","endTime","client","location","address","poc","pocPhone","uniform"].forEach(k=>{
      if(form[k] !== init[k]) dirty[k] = form[k];
    });
    const scopeNow = form.scope.filter(s=>s.trim());
    if(JSON.stringify(scopeNow) !== JSON.stringify((init.scope||[]).filter(s=>s.trim()))) dirty.scope = scopeNow;
    const updated = { ...activeShift, ...dirty };
    // Next save's baseline is what we just wrote.
    initialFormRef.current = blastSnapshot(updated);
    // Post the full briefing onto the shift (crew see it under the shift's Updates)
    // AND drop a dashboard notification so every crew member is alerted in-app.
    const ann = {id:uid(), text:messageText, ts:now(), from:currentUser?.name||"Management"};
    // Only the crew assigned to this shift should be alerted about it.
    const notif = {
      id:uid(), to:"shift", toIds:(activeShift.crew||[]).map(c=>c.rosterId||c.id), shiftId:activeShift.id, ts:now(),
      text:`📋 ${form.client} · ${form.date} — shift details posted. Open your shift to view & confirm.`,
    };
    persist({
      ...state,
      shifts: state.shifts.map(s => s.id===activeShift.id
        ? {...updated, announcements:[ann, ...(updated.announcements||[])]}
        : s),
      notifications: [notif, ...state.notifications],
    });
    setPosted(true);
    setTimeout(()=>setPosted(false), 2500);
    // Real SMS of the full brief to the included recipients (no-op without Twilio).
    sendSMSPing(allPhones, messageText);
  }

  // Custom-note delivery: same pipeline as the structured blast — shift
  // announcement + in-app notification + SMS ping — without touching any
  // shift fields.
  function postCustomNote() {
    const text = customMsg.trim();
    if(!text) return;
    const ann = {id:uid(), text, ts:now(), from:currentUser?.name||"Management"};
    const notif = {
      id:uid(), to:"shift", toIds:(activeShift.crew||[]).map(c=>c.rosterId||c.id), shiftId:activeShift.id, ts:now(),
      text: text.length > 120 ? text.slice(0,117)+"…" : text,
    };
    persist({
      ...state,
      shifts: state.shifts.map(s => s.id===activeShift.id
        ? {...s, announcements:[ann, ...(s.announcements||[])], lastUpdated:now()}
        : s),
      notifications: [notif, ...state.notifications],
    });
    setPosted(true);
    setTimeout(()=>setPosted(false), 2500);
    sendSMSPing(allPhones, text);
  }

  // Build recipient lists. Resolve contact info from the CURRENT roster (by
  // rosterId) so a number/email the manager updated after the shift was created
  // is used — falling back to the snapshot on the crew entry if not on roster.
  const contactFor = (c) => {
    const r = state.roster.find(m => m.id === (c.rosterId||c.id));
    return { email: (r?.email)||c.email||"", phone: (r?.phone)||c.phone||"" };
  };
  const includedCrewObjs = (activeShift.crew||[]).filter(c=>includedCrew.includes(c.id));
  const crewEmails = includedCrewObjs.map(contactFor).map(x=>x.email).filter(Boolean);
  const extraEmails = extraRecipients.filter(r=>r.email).map(r=>r.email);
  const manualList = manualEmails ? manualEmails.split(",").map(e=>e.trim()).filter(Boolean) : [];
  const allEmails = [...crewEmails, ...extraEmails, ...manualList];

  const crewPhones = includedCrewObjs.map(contactFor).map(x=>x.phone).filter(Boolean);
  const extraPhones = extraRecipients.filter(r=>r.phone).map(r=>r.phone);
  const allPhones = [...crewPhones, ...extraPhones];

  // Mailto / SMS
  const mailto = `mailto:${allEmails.join(",")}?subject=${encodeURIComponent(`BigCrew NYC – ${form.client} Shift ${form.date}`)}&body=${encodeURIComponent(messageText)}`;
  const smsHref = `sms:${allPhones.join(",")}?&body=${encodeURIComponent(messageText)}`;

  // Available crew NOT included (so manager can add them back)
  const availableToAdd = (activeShift.crew||[]).filter(c=>!includedCrew.includes(c.id));

  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:C.font,color:C.text}}>
      <style>{GS}</style>
      <PageHeader title="Blast Message" sub={`${form.client} · ${form.date}`} onBack={()=>setScreen("home")}/>

      <div className="bcn-body">
        {/* Mode toggle: structured shift blast vs. custom note */}
        <div style={{display:"flex",gap:"4px",background:C.s1,padding:"4px",borderRadius:"8px",border:`1px solid ${C.border}`,marginBottom:"12px"}}>
          {[{k:"blast",l:"📋 Shift Blast"},{k:"custom",l:"✏️ Custom Note"}].map(o=>(
            <button key={o.k} onClick={()=>setMsgMode(o.k)} style={{
              flex:1,padding:"9px 6px",fontSize:"11px",fontWeight:"700",letterSpacing:"0.04em",
              background: msgMode===o.k ? "#E8C84A" : "transparent", color: msgMode===o.k ? "#1a1400" : C.muted,
              border:"none",borderRadius:"6px",cursor:"pointer",fontFamily:C.font,
            }}>{o.l}</button>
          ))}
        </div>

        {msgMode==="custom" && (
          <div style={{...card({border:`1.5px solid ${C.gold}`,marginBottom:"12px"})}}>
            <span style={lbl}>✏️ Custom Note to Crew</span>
            <div style={{fontSize:"10px",color:C.muted,marginTop:"3px",marginBottom:"8px"}}>Free-form announcement — company update, schedule change, reminder. Goes to the recipients you select below.</div>
            <textarea value={customMsg} onChange={e=>setCustomMsg(e.target.value)} placeholder={"e.g. Team — call time for tomorrow moved up 30 min to 2:30 PM. Reply to confirm."}
              style={{...inp,minHeight:"120px",resize:"vertical"}}/>
            {/* Custom notes previously had NO in-app/SMS delivery — only the
                manual send links — so crew who rely on the app never saw them. */}
            <button onClick={postCustomNote} disabled={!customMsg.trim()}
              style={{...btn("green",true),padding:"12px",marginTop:"10px",opacity:customMsg.trim()?1:0.5}}>
              {posted ? "✓ POSTED — CREW NOTIFIED" : "📢 POST & NOTIFY CREW"}
            </button>
          </div>
        )}

        <div className="bcn-row-side">
          {/* ── LEFT: STRUCTURED EDITOR ── */}
          <div style={{display:msgMode==="custom"?"none":"flex",flexDirection:"column",gap:"12px"}}>
            <div style={{...card({border:`1.5px solid ${C.gold}`})}}>
              <div style={{fontSize:"11px",color:C.gold,fontWeight:"700",letterSpacing:"0.12em",marginBottom:"10px"}}>📝 EDIT MESSAGE FIELDS</div>
              <div style={{fontSize:"11px",color:C.muted,lineHeight:"1.6"}}>Every field below auto-updates the message preview. Changes save to the shift when you tap SAVE.</div>
            </div>

            {/* Notes line */}
            <div style={card()}>
              <span style={lbl}>⚠️ Notes line</span>
              <input value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} style={{...inp,marginTop:"4px"}}/>
            </div>

            {/* Date / Time */}
            <div style={card()}>
              <span style={lbl}>📅 Date & Time</span>
              <div style={{display:"grid",gridTemplateColumns:"1fr",gap:"6px",marginTop:"6px"}}>
                <input value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))} placeholder="MM/DD/YYYY" style={inp}/>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px"}}>
                  <input value={form.callTime} onChange={e=>setForm(f=>({...f,callTime:e.target.value}))} placeholder="3:00 PM" style={inp}/>
                  <input value={form.endTime} onChange={e=>setForm(f=>({...f,endTime:e.target.value}))} placeholder="12:00 AM" style={inp}/>
                </div>
              </div>
            </div>

            {/* Client / Location / Address */}
            <div style={card()}>
              <span style={lbl}>🏢 Client & Location</span>
              <div style={{display:"flex",flexDirection:"column",gap:"6px",marginTop:"6px"}}>
                <input value={form.client} onChange={e=>setForm(f=>({...f,client:e.target.value}))} placeholder="Client" style={inp}/>
                <input value={form.location} onChange={e=>setForm(f=>({...f,location:e.target.value}))} placeholder="Location" style={inp}/>
                <input value={form.address} onChange={e=>setForm(f=>({...f,address:e.target.value}))} placeholder="Full address" style={inp}/>
              </div>
            </div>

            {/* Scope */}
            <div style={card()}>
              <span style={lbl}>📋 Scope of Work</span>
              <div style={{display:"flex",flexDirection:"column",gap:"6px",marginTop:"6px"}}>
                {form.scope.map((s,i)=>(
                  <div key={i} style={{display:"flex",gap:"6px",alignItems:"center"}}>
                    <input value={s} onChange={e=>updateScope(i,e.target.value)} placeholder={`Task ${i+1}`} style={{...inp,flex:1}}/>
                    <button onClick={()=>removeScope(i)} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:"6px",color:C.dim,cursor:"pointer",fontSize:"13px",padding:"6px 10px",fontFamily:C.font}}>✕</button>
                  </div>
                ))}
                <button onClick={addScopeLine} style={{...btn("ghost",true),border:`1px dashed ${C.border}`,padding:"8px",fontSize:"11px"}}>+ Add Scope Item</button>
              </div>
            </div>

            {/* Uniform */}
            <div style={card()}>
              <span style={lbl}>👕 Uniform</span>
              <textarea value={form.uniform} onChange={e=>setForm(f=>({...f,uniform:e.target.value}))} style={{...inp,marginTop:"6px",minHeight:"60px",resize:"vertical"}}/>
            </div>

            {/* POC */}
            <div style={card()}>
              <span style={lbl}>📞 Point of Contact</span>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px",marginTop:"6px"}}>
                <input value={form.poc} onChange={e=>setForm(f=>({...f,poc:e.target.value}))} placeholder="POC name" style={inp}/>
                <input value={form.pocPhone} onChange={e=>setForm(f=>({...f,pocPhone:e.target.value}))} placeholder="POC phone" style={inp}/>
              </div>
            </div>

            {/* Crew */}
            <div style={card()}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"6px"}}>
                <span style={lbl}>👥 Crew on this Message ({includedCrew.length + extraRecipients.length})</span>
                <button onClick={()=>setShowAddCrew(!showAddCrew)} style={{...btn("ghost"),padding:"4px 10px",fontSize:"10px",border:`1px solid ${C.border}`}}>{showAddCrew?"DONE":"+ ADD"}</button>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:"4px",marginTop:"6px"}}>
                {(activeShift.crew||[]).map((c,i)=>{
                  const inc = includedCrew.includes(c.id);
                  return (
                    <div key={c.id} onClick={()=>toggleCrew(c.id)}
                      style={{display:"flex",alignItems:"center",gap:"8px",padding:"6px 8px",borderRadius:"6px",background:inc?C.greenBg:C.s2,border:`1px solid ${inc?C.green:C.border}`,cursor:"pointer"}}>
                      <div style={{width:"16px",height:"16px",borderRadius:"3px",background:inc?C.green:C.s1,border:`1.5px solid ${inc?C.green:C.borderHi}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"10px",color:"#000",flexShrink:0}}>{inc?"✓":""}</div>
                      <div style={{flex:1,fontSize:"12px",fontWeight:"600",color:inc?C.green:C.text}}>{c.name}</div>
                      {c.role==="Supervisor"&&<span style={badge(C.gold,C.goldBg)}>SUP</span>}
                    </div>
                  );
                })}
                {extraRecipients.map(r=>(
                  <div key={r.id} style={{display:"flex",alignItems:"center",gap:"8px",padding:"6px 8px",borderRadius:"6px",background:C.blueBg,border:`1px solid ${C.blue}`}}>
                    <div style={{width:"16px",height:"16px",borderRadius:"3px",background:C.blue,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"10px",color:"#000"}}>✓</div>
                    <div style={{flex:1,fontSize:"12px",fontWeight:"600",color:C.blue}}>{r.name}</div>
                    <span style={badge(C.blue,"transparent")}>EXTRA</span>
                    <button onClick={()=>removeExtra(r.id)} style={{background:"none",border:"none",color:C.dim,cursor:"pointer",fontSize:"12px"}}>✕</button>
                  </div>
                ))}
              </div>

              {showAddCrew && (
                <div style={{...card({background:C.s2,marginTop:"10px",border:`1px dashed ${C.border}`})}}>
                  <span style={lbl}>Add one-off recipient</span>
                  <div style={{display:"flex",flexDirection:"column",gap:"5px",marginTop:"6px"}}>
                    <input value={newRecipient.name} onChange={e=>setNewRecipient(n=>({...n,name:e.target.value}))} placeholder="Name *" style={inp}/>
                    <input value={newRecipient.email} onChange={e=>setNewRecipient(n=>({...n,email:e.target.value}))} placeholder="Email" style={inp}/>
                    <input value={newRecipient.phone} onChange={e=>setNewRecipient(n=>({...n,phone:e.target.value}))} placeholder="Phone" style={inp}/>
                    <button onClick={addExtraRecipient} disabled={!newRecipient.name.trim()} style={{...btn("gold",true),opacity:newRecipient.name.trim()?1:0.4}}>ADD TO MESSAGE</button>
                  </div>
                </div>
              )}
            </div>

            {/* Extra notes */}
            <div style={card()}>
              <span style={lbl}>➕ Additional Notes (appended to bottom)</span>
              <textarea value={form.extraNotes} onChange={e=>setForm(f=>({...f,extraNotes:e.target.value}))}
                placeholder="e.g. Parking info, food provided, etc." style={{...inp,marginTop:"6px",minHeight:"60px",resize:"vertical"}}/>
            </div>

            <button onClick={saveToShift} style={{...btn("green",true),padding:"12px"}}>
              {posted ? "✓ POSTED — CREW NOTIFIED" : "💾 SAVE TO SHIFT & NOTIFY CREW"}
            </button>
          </div>

          {/* ── RIGHT: LIVE PREVIEW + SEND ── */}
          <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
            <div style={{...card({border:`1.5px solid ${C.gold}`})}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"10px"}}>
                <div style={{fontSize:"11px",color:C.gold,fontWeight:"700",letterSpacing:"0.12em"}}>📨 LIVE PREVIEW</div>
                <div style={{fontSize:"9px",color:C.muted}}>{messageText.length} chars</div>
              </div>
              <div style={{background:C.s2,borderRadius:"7px",padding:"14px",fontSize:"12px",lineHeight:"1.8",color:C.text,whiteSpace:"pre-wrap",fontFamily:"'Courier New',monospace",maxHeight:"480px",overflowY:"auto",border:`1px solid ${C.border}`}}>
                {messageText}
              </div>
            </div>

            {/* Send buttons */}
            <div style={card()}>
              <span style={lbl}>📤 Send to Crew</span>
              <div style={{display:"flex",flexDirection:"column",gap:"8px",marginTop:"10px"}}>
                <button onClick={copyMsg} style={{...btn(copied?"green":"gold",true),padding:"12px"}}>
                  {copied ? "✓ COPIED TO CLIPBOARD!" : "📋 COPY MESSAGE"}
                </button>
                <a href={smsHref} style={{...btn("green",true),padding:"12px",textDecoration:"none",textAlign:"center",display:"block"}}>
                  💬 SMS GROUP {allPhones.length>0?`(${allPhones.length})`:""}
                </a>
                <a href={mailto} style={{...btn("blue",true),padding:"12px",textDecoration:"none",textAlign:"center",display:"block"}}>
                  📧 SEND VIA EMAIL {allEmails.length>0?`(${allEmails.length})`:""}
                </a>
              </div>
              <div style={{fontSize:"9px",color:C.dim,marginTop:"8px",lineHeight:"1.5"}}>
                <b style={{color:C.muted}}>Honest note:</b> "SMS Group" creates a group chat on most phones. To send <b>individually</b>, use the per-person links below.
              </div>
            </div>

            {/* INDIVIDUAL SMS - tap each one separately. Contact info comes
                from the CURRENT roster (contactFor), matching the group blast —
                the frozen snapshot on the crew entry texted dead numbers. */}
            {(activeShift.crew||[]).filter(c=>includedCrew.includes(c.id) && contactFor(c).phone).length>0 && (
              <div style={card()}>
                <span style={lbl}>📱 Or send 1-on-1 individually</span>
                <div style={{fontSize:"10px",color:C.muted,marginTop:"4px",marginBottom:"10px",lineHeight:"1.5"}}>
                  Tap each name → opens their personal SMS thread with the message pre-filled.
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
                  {(activeShift.crew||[]).filter(c=>includedCrew.includes(c.id) && contactFor(c).phone).map(c=>(
                    <a key={c.id} href={`sms:${contactFor(c).phone}?&body=${encodeURIComponent(messageText)}`}
                      style={{display:"flex",alignItems:"center",gap:"10px",padding:"10px 12px",background:C.s2,borderRadius:"7px",border:`1px solid ${C.border}`,textDecoration:"none",color:C.text}}>
                      <span style={{fontSize:"14px"}}>💬</span>
                      <div style={{flex:1}}>
                        <div style={{fontSize:"12px",fontWeight:"700"}}>{c.name}</div>
                        <div style={{fontSize:"9px",color:C.muted}}>{contactFor(c).phone}</div>
                      </div>
                      <span style={{fontSize:"11px",color:C.green}}>SEND →</span>
                    </a>
                  ))}
                </div>
                <div style={{fontSize:"9px",color:C.dim,marginTop:"10px",lineHeight:"1.5"}}>
                  For <b>fully automated</b> bulk SMS sending (no manual taps), you'd need a service like Twilio (~$0.0079 per SMS — verify current pricing at twilio.com).
                </div>
              </div>
            )}

            {/* Manual additional emails */}
            <div style={card()}>
              <span style={lbl}>+ Additional emails (comma separated)</span>
              <input value={manualEmails} onChange={e=>setManualEmails(e.target.value)}
                placeholder="boss@bigcrew.com, other@email.com"
                style={{...inp,marginTop:"6px"}}/>
            </div>

            {/* Recipient summary */}
            <div style={card()}>
              <span style={lbl}>📊 Recipient Status</span>
              <div style={{marginTop:"8px",display:"flex",flexDirection:"column",gap:"6px"}}>
                {(activeShift.crew||[]).filter(c=>includedCrew.includes(c.id)).map(c=>{
                  const fresh = contactFor(c);
                  return (
                    <div key={c.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:"11px",padding:"4px 0"}}>
                      <span style={{color:C.text}}>{c.name}</span>
                      <div style={{display:"flex",gap:"6px"}}>
                        <span style={{color:fresh.phone?C.green:C.dim}}>{fresh.phone?"📱":"—"}</span>
                        <span style={{color:fresh.email?C.green:C.dim}}>{fresh.email?"📧":"—"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {savePrompt && (
        <SaveToRosterModal
          person={savePrompt}
          onSave={saveNewToRoster}
          onSkip={()=>setSavePrompt(null)}
          onClose={()=>setSavePrompt(null)}
        />
      )}
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// ADMIN SCREEN
// ══════════════════════════════════════════════════════════════════════════════
function AdminScreen({state,persist,updateShift,setScreen,currentUser,activeShift,setActiveShiftId}) {
  const [tab,setTab]=useState("overview");
  const [showGcalGuide, setShowGcalGuide] = useState(false);

  if(!activeShift) return <NoShiftEmptyState title="Admin Panel" setScreen={setScreen}/>;

  function forceConfirm(cid) {
    const crew=activeShift.crew.map(c=>c.id===cid?{...c,confirmed:true,confirmedAt:now()}:c);
    persist({...state,shifts:state.shifts.map(s=>s.id===activeShift.id?{...s,crew}:s)});
  }
  function toggleAbsent(cid) {
    const crew=activeShift.crew.map(c=>c.id===cid?{...c,absent:!c.absent}:c);
    persist({...state,shifts:state.shifts.map(s=>s.id===activeShift.id?{...s,crew}:s)});
  }
  function updateCrewEmail(cid,email) {
    const crew=activeShift.crew.map(c=>c.id===cid?{...c,email}:c);
    persist({...state,shifts:state.shifts.map(s=>s.id===activeShift.id?{...s,crew}:s)});
  }
  function completeShift() {
    persist({...state,shifts:state.shifts.map(s=>s.id===activeShift.id?{...s,status:"completed"}:s)});
  }

  const conf=activeShift.crew.filter(c=>c.confirmed).length;
  const ci=activeShift.crew.filter(c=>c.clockIn&&!c.clockOut).length;
  const ab=activeShift.crew.filter(c=>c.absent).length;
  const totalH=activeShift.crew.reduce((a,c)=>a+calcHours(c.clockIn,c.clockOut).total,0);

  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:C.font,color:C.text}}>
      <style>{GS}</style>
      <div style={{background:C.s1,borderBottom:`2px solid ${C.gold}`,padding:"14px",position:"sticky",top:0,zIndex:50}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
            <Logo size={32}/>
            <div>
              <div style={{fontFamily:C.head,fontSize:"18px",letterSpacing:"0.08em",color:C.gold,lineHeight:1}}>ADMIN PANEL</div>
              <div style={{fontSize:"9px",color:C.muted,letterSpacing:"0.14em"}}>{activeShift.client} · {activeShift.date}</div>
            </div>
          </div>
          <button onClick={()=>setScreen("home")} style={{...btn("ghost"),padding:"6px 10px",fontSize:"10px",border:`1px solid ${C.border}`}}>← HOME</button>
        </div>
      </div>

      <div style={{display:"flex",gap:"3px",padding:"8px 12px",background:C.s1,borderBottom:`1px solid ${C.border}`,overflowX:"auto"}}>
        {["overview","crew","shifts","roster"].map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{...tabBtn(tab===t),flex:"none",padding:"7px 10px",fontSize:"9px",whiteSpace:"nowrap"}}>
            {t==="overview"?"📊 Overview":t==="crew"?"👥 Crew":t==="shifts"?"📅 Shifts":"📋 Roster"}
          </button>
        ))}
      </div>

      <div className="bcn-body" style={{paddingBottom:"80px"}}>
        {tab==="overview"&&(
          <div style={{animation:"fadeUp 0.3s ease"}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px",marginBottom:"14px"}}>
              {[
                {label:"Confirmed",value:`${conf}/${activeShift.crew.length}`,color:C.green,icon:"✅"},
                {label:"On Site",value:ci,color:C.blue,icon:"⏱"},
                {label:"Absent",value:ab,color:C.red,icon:"❌"},
                {label:"Total Hours",value:fmtHours(totalH),color:C.gold,icon:"🕐"},
              ].map(s=>(
                <div key={s.label} style={{...card({textAlign:"center"})}}>
                  <div style={{fontSize:"22px",marginBottom:"4px"}}>{s.icon}</div>
                  <div style={{fontSize:"20px",fontWeight:"700",color:s.color}}>{s.value}</div>
                  <div style={{fontSize:"9px",color:C.muted,letterSpacing:"0.12em",marginTop:"2px"}}>{s.label.toUpperCase()}</div>
                </div>
              ))}
            </div>

            {/* Live crew status */}
            <span style={lbl}>Live Crew Status</span>
            <div style={{display:"flex",flexDirection:"column",gap:"6px",marginTop:"8px",marginBottom:"14px"}}>
              {activeShift.crew.map(c=>{
                const h=calcHours(c.clockIn,c.clockOut);
                return (
                  <div key={c.id} style={{...card({padding:"10px 12px",display:"flex",alignItems:"center",justifyContent:"space-between"})}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:"13px",fontWeight:"600",color:c.absent?C.red:C.text}}>{c.name}</div>
                      <div style={{fontSize:"9px",color:C.muted,marginTop:"2px"}}>
                        {c.confirmed?`✅ ${fmt(c.confirmedAt)}`:"⏳ Pending"}
                        {c.clockIn?` · In ${fmt(c.clockIn)}`:""}{c.clockOut?` · Out ${fmt(c.clockOut)}`:""}
                        {h.total>0?` · ${fmtHours(h.total)}`:""}
                        {h.ot>0?` (${fmtHours(h.ot)} OT)`:""}
                      </div>
                    </div>
                    <div style={{display:"flex",gap:"4px"}}>
                      {!c.confirmed&&<button onClick={()=>forceConfirm(c.id)} style={{...btn("ghost"),padding:"3px 7px",fontSize:"9px",border:`1px solid ${C.green}`,color:C.green}}>✓</button>}
                      <button onClick={()=>toggleAbsent(c.id)} style={{...btn("ghost"),padding:"3px 7px",fontSize:"9px",border:`1px solid ${c.absent?C.green:C.red}`,color:c.absent?C.green:C.red}}>
                        {c.absent?"RESTORE":"ABSENT"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{display:"flex",gap:"8px"}}>
              <button onClick={()=>setScreen("message")} style={{...btn("gold"),flex:1}}>📨 BLAST MESSAGE</button>
              {activeShift.status==="active"&&<button onClick={completeShift} style={{...btn("ghost"),flex:1,border:`1px solid ${C.green}`,color:C.green}}>🏁 COMPLETE</button>}
            </div>

            {/* Google Calendar setup */}
            <div style={{...card({marginTop:"14px",border:`1px solid ${C.blue}`})}}>
              <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                <div style={{fontSize:"22px"}}>📅</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:"12px",fontWeight:"700",color:C.blue}}>Google Calendar Integration</div>
                  <div style={{fontSize:"10px",color:C.muted,marginTop:"2px",lineHeight:"1.5"}}>Works out of the box via "Add to Calendar". Full OAuth sync requires backend setup.</div>
                </div>
                <button onClick={()=>setShowGcalGuide(true)} style={{...btn("ghost"),padding:"6px 12px",fontSize:"10px",border:`1px solid ${C.blue}`,color:C.blue}}>SETUP →</button>
              </div>
            </div>
          </div>
        )}

        {tab==="crew"&&<AdminCrewEditTab state={state} persist={persist} activeShift={activeShift}/>}
        {tab==="shifts"&&<AdminShiftsTab state={state} persist={persist} updateShift={updateShift} setScreen={setScreen} setActiveShiftId={setActiveShiftId} activeShift={activeShift} currentUser={currentUser}/>}
        {tab==="roster"&&<AdminRosterTab state={state} persist={persist} setScreen={setScreen} setActiveShiftId={setActiveShiftId}/>}
      </div>

      {showGcalGuide && <GoogleCalSetupGuide onClose={()=>setShowGcalGuide(false)}/>}
    </div>
  );
}

function AdminCrewEditTab({state,persist,activeShift}) {
  const [editing,setEditing]=useState(null);
  const [form,setForm]=useState({name:"",role:"Crew",phone:"",email:""});
  const [adding,setAdding]=useState(false);

  function startEdit(c){setEditing(c.id);setForm({name:c.name,role:c.role,phone:c.phone||"",email:c.email||""});}
  function save(){
    const crew=activeShift.crew.map(c=>c.id===editing?{...c,...form}:c);
    persist({...state,shifts:state.shifts.map(s=>s.id===activeShift.id?{...s,crew}:s)});
    setEditing(null);
  }
  function addFromRoster(rosterMember){
    if(activeShift.crew.find(c=>c.rosterId===rosterMember.id)) return;
    const nm={id:uid(),rosterId:rosterMember.id,name:rosterMember.name,role:rosterMember.role,roleTag:null,phone:rosterMember.phone||"",email:rosterMember.email||"",confirmed:false,confirmedAt:null,clockIn:null,clockOut:null,absent:false};
    const crew=[...activeShift.crew,nm];
    persist({...state,shifts:state.shifts.map(s=>s.id===activeShift.id?{...s,crew}:s)});
    setAdding(false);
  }
  function removeMember(id){
    const crew=activeShift.crew.filter(c=>c.id!==id);
    persist({...state,shifts:state.shifts.map(s=>s.id===activeShift.id?{...s,crew}:s)});
  }
  function setRoleTag(cid, tag) {
    const crew=activeShift.crew.map(c=>c.id===cid?{...c,roleTag:tag}:c);
    persist({...state,shifts:state.shifts.map(s=>s.id===activeShift.id?{...s,crew}:s)});
  }
  function addCustomTag(tag) {
    persist({...state, customRoleTags:[...(state.customRoleTags||[]),tag]});
  }

  return (
    <div style={{animation:"fadeUp 0.3s ease"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"10px"}}>
        <span style={lbl}>Crew on this Shift</span>
        <button onClick={()=>setAdding(!adding)} style={{...btn("gold"),padding:"6px 12px",fontSize:"10px"}}>{adding?"✕ CANCEL":"+ ADD"}</button>
      </div>

      {adding && (
        <div style={{...card({border:`1.5px solid ${C.gold}`,marginBottom:"10px"})}}>
          <span style={lbl}>🔍 Search roster — type a name</span>
          <div style={{marginTop:"6px"}}>
            <SearchableNameDropdown
              options={state.roster}
              onSelect={addFromRoster}
              excludeIds={activeShift.crew.map(c=>c.rosterId).filter(Boolean)}
              placeholder="Type 2-3 letters…"
              autoFocus
            />
          </div>
          <div style={{fontSize:"10px",color:C.muted,marginTop:"8px",lineHeight:"1.5"}}>
            Only people in your master roster appear here. Add new people via Admin → Roster tab first.
          </div>
        </div>
      )}

      <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
        {activeShift.crew.map(c=>(
          <div key={c.id} style={card()}>
            {editing===c.id?(
              <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                <input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Full name" style={inp}/>
                <select value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value}))} style={{...inp,appearance:"none"}}>
                  <option value="Supervisor">Supervisor</option><option value="Crew">Crew</option>
                </select>
                <input value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))} placeholder="Phone" style={inp}/>
                <input value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} placeholder="Email" style={inp}/>
                <div style={{display:"flex",gap:"6px"}}>
                  <button onClick={save} style={{...btn("gold"),flex:1}}>SAVE</button>
                  <button onClick={()=>setEditing(null)} style={{...btn("ghost"),flex:1,border:`1px solid ${C.border}`}}>CANCEL</button>
                </div>
              </div>
            ):(
              <>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"8px"}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:"13px",fontWeight:"700"}}>{c.name}{c.role==="Supervisor"&&<span style={{...badge(C.gold,C.goldBg),marginLeft:"6px"}}>SUP</span>}</div>
                    <div style={{fontSize:"10px",color:C.muted,marginTop:"2px"}}>{c.email||"no email"} · {c.phone||"no phone"}</div>
                  </div>
                  <div style={{display:"flex",gap:"5px"}}>
                    <button onClick={()=>startEdit(c)} style={{...btn("ghost"),padding:"5px 10px",fontSize:"10px",border:`1px solid ${C.border}`}}>EDIT</button>
                    <button onClick={()=>removeMember(c.id)} style={{...btn("ghost"),padding:"5px 8px",fontSize:"10px",border:`1px solid ${C.redBg}`,color:C.red}}>✕</button>
                  </div>
                </div>
                {/* Role tag picker */}
                <div style={{paddingTop:"8px",borderTop:`1px solid ${C.border}`}}>
                  <div style={{fontSize:"9px",color:C.dim,letterSpacing:"0.1em",marginBottom:"6px"}}>SHIFT ROLE TAG</div>
                  <RoleTagPicker value={c.roleTag} onChange={tag=>setRoleTag(c.id,tag)} customTags={state.customRoleTags||[]} onAddCustom={addCustomTag} compact/>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminEmailTab({state,persist,activeShift,updateEmail}) {
  const [emails,setEmails]=useState(()=>Object.fromEntries(activeShift.crew.map(c=>[c.id,c.email||""])));

  function saveAll(){
    let crew=activeShift.crew.map(c=>({...c,email:emails[c.id]||""}));
    // Also update roster
    let roster=state.roster.map(m=>{
      const match=activeShift.crew.find(c=>c.rosterId===m.id);
      return match?{...m,email:emails[match.id]||m.email}:m;
    });
    persist({...state,roster,shifts:state.shifts.map(s=>s.id===activeShift.id?{...s,crew}:s)});
  }

  return (
    <div style={{animation:"fadeUp 0.3s ease"}}>
      <div style={{...card({background:C.s2,marginBottom:"12px"})}}>
        <div style={{fontSize:"11px",color:C.muted,lineHeight:"1.6"}}>Enter email addresses for each crew member. These will be used for the blast message email feature. Emails save to the master roster.</div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:"8px",marginBottom:"12px"}}>
        {activeShift.crew.map(c=>(
          <div key={c.id} style={card()}>
            <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"6px"}}>
              <div style={{width:"28px",height:"28px",borderRadius:"6px",background:C.s2,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"11px",fontWeight:"700",color:C.muted}}>{initials(c.name)}</div>
              <div style={{fontSize:"13px",fontWeight:"600"}}>{c.name}</div>
              {c.role==="Supervisor"&&<span style={badge(C.gold,C.goldBg)}>SUP</span>}
            </div>
            <input value={emails[c.id]||""} onChange={e=>setEmails(prev=>({...prev,[c.id]:e.target.value}))}
              placeholder={`${c.name.split(" ")[0].toLowerCase()}@email.com`} style={inp}/>
          </div>
        ))}
      </div>
      <button onClick={saveAll} style={{...btn("gold",true)}}>💾 SAVE ALL EMAILS</button>
    </div>
  );
}

function AdminShiftsTab({state,persist,updateShift,setScreen,setActiveShiftId,activeShift,currentUser}) {
  const [editing, setEditing] = useState(null); // shift id being edited
  const [draft, setDraft] = useState({});

  function deleteShift(id){
    if(state.shifts.length<=1) return;
    if(!confirm("Delete this shift permanently?")) return;
    const newShifts=state.shifts.filter(s=>s.id!==id);
    persist({...state,shifts:newShifts});
    if(activeShift.id===id) setActiveShiftId(newShifts[0].id);
  }

  function duplicateShift(s){
    const copy = {
      ...s,
      id: uid(),
      client: s.client + " (copy)",
      pipelineStatus: "draft",
      crew: s.crew.map(c => ({...c, id:uid(), confirmed:false, confirmedAt:null, declined:false, declinedAt:null, clockIn:null, clockOut:null, manualHours:null})),
      announcements: [],
      createdAt: now(),
      lastUpdated: now(),
      updatedBy: currentUser?.name || "",
    };
    persist({...state, shifts:[...state.shifts, copy]});
  }

  function startEdit(s){
    setEditing(s.id);
    setDraft({
      client: s.client,
      date: s.date,
      callTime: s.callTime,
      endTime: s.endTime,
      location: s.location,
      address: s.address || "",
      requiredPositions: s.requiredPositions || s.crew.length,
    });
  }

  function saveEdit(id){
    updateShift(id, s => ({
      ...s,
      client: draft.client,
      date: draft.date,
      callTime: draft.callTime,
      endTime: draft.endTime,
      location: draft.location,
      address: draft.address,
      requiredPositions: parseInt(draft.requiredPositions) || s.crew.length,
    }), currentUser?.name);
    setEditing(null);
  }

  function setStatusOverride(id, value){
    updateShift(id, s => ({...s, pipelineStatus: value === "auto" ? null : value}), currentUser?.name);
  }

  return (
    <div style={{animation:"fadeUp 0.3s ease"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"10px"}}>
        <span style={lbl}>All Shifts ({state.shifts.length})</span>
        <button onClick={()=>setScreen("newshift")} style={{...btn("gold"),padding:"6px 12px",fontSize:"10px"}}>+ NEW SHIFT</button>
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
        {[...state.shifts].sort((a,b)=>{
          const da=parseShiftStart(a.date,a.callTime), db=parseShiftStart(b.date,b.callTime);
          return (db?.getTime()||0)-(da?.getTime()||0);
        }).map(s=>{
          const isActive = s.id===activeShift.id;
          const status = deriveShiftStatus(s);
          const f = fillCounts(s);
          const isEditing = editing===s.id;
          return (
            <div key={s.id} style={{...card({border:`1px solid ${isActive?C.gold:C.border}`})}}>
              {/* Header row */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"8px"}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:"14px",fontWeight:"700",color:isActive?C.gold:C.text}}>{s.client}{isActive?" ·  ACTIVE":""}</div>
                  <div style={{fontSize:"10px",color:C.muted,marginTop:"2px"}}>{s.date} · {s.callTime}–{s.endTime||"?"}{shiftScheduledHours(s)!=null?` · ${shiftScheduledHours(s)}h`:""} · {s.location}</div>
                </div>
                <LastUpdatedBadge timestamp={s.lastUpdated} by={s.updatedBy} prominent/>
              </div>

              {/* Badges */}
              <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"10px"}}>
                <StatusBadge status={status}/>
                <FillBadge shift={s}/>
                {f.confirmed>0 && <span style={badge(C.green,"transparent")}>{f.confirmed} confirmed</span>}
                {f.declined>0 && <span style={badge(C.red,"transparent")}>{f.declined} declined</span>}
              </div>

              {/* Inline editor */}
              {isEditing ? (
                <div style={{background:C.s2,borderRadius:"8px",padding:"12px",marginBottom:"10px",display:"flex",flexDirection:"column",gap:"8px"}}>
                  <div>
                    <span style={lbl}>Client / Job</span>
                    <input value={draft.client} onChange={e=>setDraft(d=>({...d,client:e.target.value}))} style={{...inp,marginTop:"4px"}}/>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
                    <div>
                      <span style={lbl}>Date</span>
                      <input value={draft.date} onChange={e=>setDraft(d=>({...d,date:e.target.value}))} placeholder="MM/DD/YYYY" style={{...inp,marginTop:"4px"}}/>
                    </div>
                    <div>
                      <span style={lbl}>Req. Positions</span>
                      <input type="number" min="1" value={draft.requiredPositions} onChange={e=>setDraft(d=>({...d,requiredPositions:e.target.value}))} style={{...inp,marginTop:"4px"}}/>
                    </div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
                    <div>
                      <span style={lbl}>Call Time</span>
                      <TimeInput value={draft.callTime} onChange={v=>setDraft(d=>({...d,callTime:v}))}/>
                    </div>
                    <div>
                      <span style={lbl}>End Time</span>
                      <TimeInput value={draft.endTime} onChange={v=>setDraft(d=>({...d,endTime:v}))}/>
                    </div>
                  </div>
                  <div>
                    <span style={lbl}>Location</span>
                    <input value={draft.location} onChange={e=>setDraft(d=>({...d,location:e.target.value}))} style={{...inp,marginTop:"4px"}}/>
                  </div>
                  <div>
                    <span style={lbl}>Address</span>
                    <input value={draft.address} onChange={e=>setDraft(d=>({...d,address:e.target.value}))} style={{...inp,marginTop:"4px"}}/>
                  </div>
                  <div style={{display:"flex",gap:"6px",marginTop:"4px"}}>
                    <button onClick={()=>saveEdit(s.id)} style={{...btn("gold"),flex:1}}>✓ SAVE CHANGES</button>
                    <button onClick={()=>setEditing(null)} style={{...btn("ghost"),flex:1,border:`1px solid ${C.border}`}}>CANCEL</button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Status override */}
                  <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"10px"}}>
                    <span style={{fontSize:"10px",color:C.muted,letterSpacing:"0.08em"}}>STATUS:</span>
                    <select value={s.pipelineStatus || "auto"} onChange={e=>setStatusOverride(s.id, e.target.value)}
                      style={{...inp,padding:"6px 8px",fontSize:"11px",width:"auto",flex:1,appearance:"none"}}>
                      <option value="auto">Auto ({STATUS_META[status].label})</option>
                      <option value="draft">Draft</option>
                      <option value="paid">Paid</option>
                      <option value="archived">Archived</option>
                    </select>
                  </div>

                  {/* Action buttons */}
                  <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
                    <button onClick={()=>startEdit(s)} style={{...btn("ghost"),flex:1,padding:"7px",fontSize:"10px",border:`1px solid ${C.gold}`,color:C.gold}}>✏ EDIT</button>
                    <button onClick={()=>{setActiveShiftId(s.id);setScreen("shift");}} style={{...btn("ghost"),flex:1,padding:"7px",fontSize:"10px",border:`1px solid ${C.border}`,color:C.muted}}>OPEN</button>
                    <button onClick={()=>duplicateShift(s)} style={{...btn("ghost"),padding:"7px 10px",fontSize:"10px",border:`1px solid ${C.border}`,color:C.muted}}>⧉</button>
                    {!isActive&&<button onClick={()=>setActiveShiftId(s.id)} style={{...btn("ghost"),padding:"7px 10px",fontSize:"10px",border:`1px solid ${C.green}`,color:C.green}}>SET ACTIVE</button>}
                    {state.shifts.length>1&&<button onClick={()=>deleteShift(s.id)} style={{...btn("ghost"),padding:"7px 10px",fontSize:"10px",border:`1px solid ${C.redBg}`,color:C.red}}>🗑</button>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Standalone roster page — reachable with zero shifts, unlike the Admin panel
// (which is scoped to an active shift and refuses to open without one).
function RosterScreen({state,persist,setScreen,setActiveShiftId}) {
  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:C.font,color:C.text}}>
      <style>{GS}</style>
      <PageHeader title="Crew Roster" sub="Your People" onBack={()=>setScreen("home")}/>
      <div className="bcn-body" style={{paddingTop:"12px"}}>
        <AdminRosterTab state={state} persist={persist} setScreen={setScreen} setActiveShiftId={setActiveShiftId}/>
      </div>
    </div>
  );
}

function AdminRosterTab({state,persist,setScreen,setActiveShiftId}) {
  const [adding,setAdding]=useState(false);
  const [form,setForm]=useState({name:"",role:"Crew",position:"",phone:"",email:"",pin:"0000",notes:""});
  const [search,setSearch]=useState("");
  const [sortBy,setSortBy]=useState("name"); // name | rate | shifts
  const [showArchived,setShowArchived]=useState(false);
  const [profileId,setProfileId]=useState(null); // open crew profile

  function addMember(){
    if(!form.name.trim()) return;
    const member={id:uid(),...form,available:true,active:true,tags:[]};
    persist({...state,roster:[...state.roster,member]});
    setForm({name:"",role:"Crew",position:"",phone:"",email:"",pin:"0000",notes:""});
    setAdding(false);
  }
  function updateMember(id, patch){
    persist({...state,roster:state.roster.map(r=>r.id===id?{...r,...patch}:r)});
  }
  function archiveMember(id){
    updateMember(id,{active:false});
  }
  function restoreMember(id){
    updateMember(id,{active:true});
  }
  function deleteMember(id){
    if(!confirm("Permanently delete this crew member from the roster?")) return;
    const gone = state.roster.find(r=>r.id===id);
    // Tombstone the deleted identity (account ids, email, name) — otherwise
    // the person's next login self-registers them right back onto the roster.
    const tombs = gone ? [
      ...(state.removedIdentities||[]),
      { userId: gone.userId || undefined,
        linkedUserIds: gone.linkedUserIds || [],
        email: gone.email || undefined,
        name: gone.name || undefined,
        ts: now() },
    ] : (state.removedIdentities||[]);
    persist({...state, roster:state.roster.filter(r=>r.id!==id), removedIdentities:tombs});
    setProfileId(null);
  }

  // Filter + sort
  let rows = state.roster.filter(m => showArchived ? m.active === false : m.active !== false);
  if (search.trim()) {
    const q = search.toLowerCase();
    rows = rows.filter(m => m.name.toLowerCase().includes(q) || (m.position||"").toLowerCase().includes(q) || (m.phone||"").includes(q) || (m.email||"").toLowerCase().includes(q));
  }
  rows = rows.map(m => ({m, stats: crewStats(m.id, state.shifts)}));
  rows.sort((a,b) => {
    if (sortBy === "rate") return (b.stats.confirmRate??-1) - (a.stats.confirmRate??-1);
    if (sortBy === "shifts") return b.stats.assigned - a.stats.assigned;
    return a.m.name.localeCompare(b.m.name);
  });

  const profileMember = profileId ? state.roster.find(m=>m.id===profileId) : null;

  return (
    <div style={{animation:"fadeUp 0.3s ease"}}>
      {/* Search + controls */}
      <div style={{display:"flex",gap:"6px",marginBottom:"10px"}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Search name, position, phone…" style={{...inp,flex:1}}/>
        <button onClick={()=>setAdding(a=>!a)} style={{...btn("gold"),padding:"8px 12px",fontSize:"10px",whiteSpace:"nowrap"}}>+ ADD</button>
      </div>
      <div style={{display:"flex",gap:"6px",marginBottom:"12px",alignItems:"center",flexWrap:"wrap"}}>
        <span style={{fontSize:"9px",color:C.muted,letterSpacing:"0.08em"}}>SORT:</span>
        {[{k:"name",l:"Name"},{k:"rate",l:"Confirm %"},{k:"shifts",l:"# Shifts"}].map(o=>(
          <button key={o.k} onClick={()=>setSortBy(o.k)} style={{
            padding:"4px 9px",fontSize:"9px",borderRadius:"5px",cursor:"pointer",fontFamily:C.font,
            background:sortBy===o.k?"#E8C84A":"transparent",color:sortBy===o.k?"#1a1400":C.muted,
            border:`1px solid ${sortBy===o.k?"#E8C84A":C.border}`,
          }}>{o.l}</button>
        ))}
        <button onClick={()=>setShowArchived(v=>!v)} style={{
          marginLeft:"auto",padding:"4px 9px",fontSize:"9px",borderRadius:"5px",cursor:"pointer",fontFamily:C.font,
          background:showArchived?C.s3:"transparent",color:showArchived?C.text:C.dim,border:`1px solid ${C.border}`,
        }}>{showArchived?"◉ Archived":"○ Show Archived"}</button>
      </div>

      {/* Add form */}
      {adding && (
        <div style={{...card({border:`1.5px solid ${C.gold}`,marginBottom:"10px"})}}>
          <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
            <input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Full name *" style={inp}/>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
              <select value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value}))} style={{...inp,appearance:"none"}}>
                <option value="Supervisor">Supervisor</option><option value="Crew">Crew</option>
              </select>
              <input value={form.position} onChange={e=>setForm(f=>({...f,position:e.target.value}))} placeholder="Position (e.g. Tech)" style={inp}/>
            </div>
            <input value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))} placeholder="Phone" style={inp}/>
            <input value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} placeholder="Email" style={inp}/>
            <input value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Internal notes (optional)" style={inp}/>
            <div>
              <span style={lbl}>4-digit PIN</span>
              <input value={form.pin} onChange={e=>setForm(f=>({...f,pin:e.target.value.replace(/\D/g,"").slice(0,4)}))} placeholder="0000" maxLength={4} style={{...inp,marginTop:"4px",textAlign:"center",letterSpacing:"0.2em"}}/>
            </div>
            <div style={{display:"flex",gap:"6px"}}>
              <button onClick={addMember} style={{...btn("gold"),flex:1}}>ADD MEMBER</button>
              <button onClick={()=>setAdding(false)} style={{...btn("ghost"),flex:1,border:`1px solid ${C.border}`}}>CANCEL</button>
            </div>
          </div>
        </div>
      )}

      {/* Database table */}
      <div style={{...card({padding:"0",overflow:"hidden"})}}>
        <div style={{overflowX:"auto"}}>
          <table style={{borderCollapse:"separate",borderSpacing:0,fontSize:"11px",fontFamily:C.font,minWidth:"100%"}}>
            <thead>
              <tr>
                {["Name","Position","Phone","Avail","Confirm %",""].map((h,i)=>(
                  <th key={i} style={{textAlign:i>=3&&i<5?"center":"left",padding:"8px 10px",fontSize:"8px",color:C.gold,letterSpacing:"0.08em",background:C.s2,borderBottom:`2px solid ${C.goldDim}`,whiteSpace:"nowrap"}}>{h.toUpperCase()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length===0 && (
                <tr><td colSpan={6} style={{textAlign:"center",color:C.muted,fontSize:"11px",padding:"24px"}}>No crew match.</td></tr>
              )}
              {rows.map(({m,stats}) => {
                const avail = m.available !== false;
                return (
                  <tr key={m.id} onClick={()=>setProfileId(m.id)} style={{cursor:"pointer"}}>
                    <td style={{padding:"8px 10px",borderBottom:`1px solid ${C.border}`,fontWeight:"700",whiteSpace:"nowrap"}}>
                      {m.name.split(" ")[0]} {m.name.split(" ")[1]?.[0]||""}.
                      {m.role==="Supervisor" && <span style={{fontSize:"7px",color:C.gold,marginLeft:"4px"}}>SUP</span>}
                    </td>
                    <td style={{padding:"8px 10px",borderBottom:`1px solid ${C.border}`,color:C.muted,whiteSpace:"nowrap"}}>{m.position||m.role}</td>
                    <td style={{padding:"8px 10px",borderBottom:`1px solid ${C.border}`,color:m.phone?C.text:C.dim,whiteSpace:"nowrap"}}>{m.phone||"—"}</td>
                    <td style={{padding:"8px 10px",borderBottom:`1px solid ${C.border}`,textAlign:"center"}}>
                      <span style={{color:avail?C.green:C.red,fontSize:"13px"}}>{avail?"●":"○"}</span>
                    </td>
                    <td style={{padding:"8px 10px",borderBottom:`1px solid ${C.border}`,textAlign:"center",color:stats.confirmRate===null?C.dim:stats.confirmRate>=80?C.green:stats.confirmRate>=50?C.gold:C.red,fontWeight:"700"}}>
                      {stats.confirmRate===null?"—":`${stats.confirmRate}%`}
                    </td>
                    <td style={{padding:"8px 10px",borderBottom:`1px solid ${C.border}`,color:C.dim,textAlign:"right"}}>›</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{fontSize:"9px",color:C.dim,marginTop:"8px",textAlign:"center"}}>Tap any row to open the full crew profile.</div>

      {/* CREW PROFILE MODAL */}
      {profileMember && (() => {
        const stats = crewStats(profileMember.id, state.shifts);
        const m = profileMember;
        return (
          <div onClick={()=>setProfileId(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:9999,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"20px",overflowY:"auto"}}>
            <div onClick={e=>e.stopPropagation()} style={{background:C.s1,border:`1.5px solid ${C.gold}`,borderRadius:"12px",padding:"20px",maxWidth:"460px",width:"100%",marginTop:"20px",marginBottom:"40px"}}>
              {/* Header */}
              <div style={{display:"flex",alignItems:"center",gap:"12px",marginBottom:"16px"}}>
                <div style={{width:"48px",height:"48px",borderRadius:"10px",background:C.s2,border:`1.5px solid ${C.borderHi}`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:"700",fontSize:"16px",color:C.gold,flexShrink:0}}>{initials(m.name)}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:"18px",fontWeight:"700",color:C.text}}>{m.name}</div>
                  <div style={{fontSize:"11px",color:C.muted}}>{m.position||m.role} · {m.role}</div>
                </div>
                <button onClick={()=>setProfileId(null)} style={{background:"none",border:"none",color:C.muted,fontSize:"22px",cursor:"pointer"}}>✕</button>
              </div>

              {/* Stat cards */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"8px",marginBottom:"16px"}}>
                <div style={{...card({textAlign:"center",padding:"10px 6px",background:C.s2})}}>
                  <div style={{fontSize:"16px",fontWeight:"700",color:C.gold}}>{stats.assigned}</div>
                  <div style={{fontSize:"7px",color:C.muted,letterSpacing:"0.1em",marginTop:"2px"}}>SHIFTS</div>
                </div>
                <div style={{...card({textAlign:"center",padding:"10px 6px",background:C.s2})}}>
                  <div style={{fontSize:"16px",fontWeight:"700",color:stats.confirmRate===null?C.dim:stats.confirmRate>=80?C.green:C.gold}}>{stats.confirmRate===null?"—":`${stats.confirmRate}%`}</div>
                  <div style={{fontSize:"7px",color:C.muted,letterSpacing:"0.1em",marginTop:"2px"}}>CONFIRM</div>
                </div>
                <div style={{...card({textAlign:"center",padding:"10px 6px",background:C.s2})}}>
                  <div style={{fontSize:"16px",fontWeight:"700",color:C.green}}>{fmtHours(stats.totalHours)}</div>
                  <div style={{fontSize:"7px",color:C.muted,letterSpacing:"0.1em",marginTop:"2px"}}>HOURS</div>
                </div>
              </div>

              {/* Editable contact */}
              <div style={{display:"flex",flexDirection:"column",gap:"8px",marginBottom:"14px"}}>
                <div>
                  <span style={lbl}>Position</span>
                  <input value={m.position||""} onChange={e=>updateMember(m.id,{position:e.target.value})} placeholder="e.g. Crew Captain" style={{...inp,marginTop:"4px"}}/>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
                  <div>
                    <span style={lbl}>Phone</span>
                    <input value={m.phone||""} onChange={e=>updateMember(m.id,{phone:e.target.value})} style={{...inp,marginTop:"4px"}}/>
                  </div>
                  <div>
                    <span style={lbl}>PIN</span>
                    <input value={m.pin||"0000"} onChange={e=>updateMember(m.id,{pin:e.target.value.replace(/\D/g,"").slice(0,4)})} maxLength={4} style={{...inp,marginTop:"4px",textAlign:"center",letterSpacing:"0.2em"}}/>
                  </div>
                </div>
                <div>
                  <span style={lbl}>Email</span>
                  <input value={m.email||""} onChange={e=>updateMember(m.id,{email:e.target.value})} style={{...inp,marginTop:"4px"}}/>
                </div>
                <div>
                  <span style={lbl}>Internal Manager Notes</span>
                  <textarea value={m.notes||""} onChange={e=>updateMember(m.id,{notes:e.target.value})} placeholder="Private notes (reliability, skills, preferences…)" style={{...inp,marginTop:"4px",minHeight:"50px",resize:"vertical"}}/>
                </div>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 10px",background:C.s2,borderRadius:"7px"}}>
                  <span style={{fontSize:"11px",color:C.text}}>Available for scheduling</span>
                  <button onClick={()=>updateMember(m.id,{available:!(m.available!==false)})} style={{
                    padding:"5px 12px",fontSize:"10px",fontWeight:"700",borderRadius:"5px",cursor:"pointer",fontFamily:C.font,
                    background: m.available!==false ? C.greenBg : C.redBg, color: m.available!==false ? C.green : C.red,
                    border:`1px solid ${m.available!==false?C.green:C.red}`,
                  }}>{m.available!==false?"● AVAILABLE":"○ UNAVAILABLE"}</button>
                </div>
              </div>

              {/* Assigned shifts history */}
              <span style={lbl}>📋 Shift History ({stats.history.length})</span>
              <div style={{display:"flex",flexDirection:"column",gap:"4px",marginTop:"6px",marginBottom:"14px",maxHeight:"160px",overflowY:"auto"}}>
                {stats.history.length===0 && <div style={{fontSize:"10px",color:C.muted,padding:"8px 0"}}>No shifts yet.</div>}
                {stats.history.slice().reverse().map((h,i)=>(
                  <div key={i} onClick={()=>{setActiveShiftId(h.shiftId);setProfileId(null);setScreen("shift");}}
                    style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:"10px",padding:"6px 8px",background:C.s2,borderRadius:"5px",cursor:"pointer"}}>
                    <span style={{color:C.text}}>{h.date} · {h.client}</span>
                    <span style={{color:h.declined?C.red:h.confirmed?C.green:C.muted}}>{h.declined?"declined":h.confirmed?"confirmed":"pending"}{h.hours>0?` · ${fmtHours(h.hours)}`:""}</span>
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div style={{display:"flex",gap:"6px"}}>
                {m.active !== false
                  ? <button onClick={()=>{archiveMember(m.id);setProfileId(null);}} style={{...btn("ghost"),flex:1,border:`1px solid ${C.border}`,color:C.muted}}>📦 ARCHIVE</button>
                  : <button onClick={()=>{restoreMember(m.id);}} style={{...btn("ghost"),flex:1,border:`1px solid ${C.green}`,color:C.green}}>↺ RESTORE</button>}
                <button onClick={()=>deleteMember(m.id)} style={{...btn("ghost"),padding:"10px 14px",border:`1px solid ${C.redBg}`,color:C.red}}>🗑 DELETE</button>
                <button onClick={()=>setProfileId(null)} style={{...btn("gold"),flex:1}}>DONE</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// NEW SHIFT
// ══════════════════════════════════════════════════════════════════════════════
function NewShiftScreen({state,persist,setScreen,setActiveShiftId,currentUser}) {
  const [form,setForm]=useState({client:"",date:new Date().toISOString().slice(0,10),callTime:"",endTime:"",location:"",address:"",poc:"",pocPhone:"",requiredPositions:"",notes:"Please don't be late and make sure you have ID's",uniform:"Clean Big Crew T-Shirt / Black Jeans, Cargo or Regular All-Black Pants / Black Sneakers"});
  const [scopeLines,setScopeLines]=useState([""]);
  // selectedCrew: array of {rosterId, roleTag}
  const [selectedCrew,setSelectedCrew]=useState([]);
  const [bulkEmails, setBulkEmails] = useState("");
  const [showBulkEmail, setShowBulkEmail] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickForm, setQuickForm] = useState({name:"",position:"",phone:"",email:""});
  const [briefPaste, setBriefPaste] = useState("");
  const [briefResult, setBriefResult] = useState(null); // {filled:[], matched:[], unmatched:[]}
  const [showBriefPaste, setShowBriefPaste] = useState(true);

  // Paste & Autofill: parse the group-text-style brief, fill the form, and
  // auto-select every crew name that matches the roster.
  function autofillFromBrief() {
    const parsed = parseShiftBrief(briefPaste, state.roster);
    if (!parsed) return;
    const filled = [];
    setForm(f => {
      const next = { ...f };
      Object.entries(parsed.form).forEach(([k, v]) => { if (v) { next[k] = v; filled.push(k); } });
      return next;
    });
    if (parsed.scope.length) setScopeLines(parsed.scope);
    if (parsed.matched.length) {
      setSelectedCrew(prev => {
        const merged = [...prev];
        parsed.matched.forEach(m => {
          if (!merged.find(s => s.rosterId === m.rosterId)) merged.push({ rosterId: m.rosterId, roleTag: m.roleTag || null });
        });
        return merged;
      });
    }
    setBriefResult({ filled, matched: parsed.matched, unmatched: parsed.unmatched });
  }

  // Rookie added on the spot: same shape as the Roster screen's add, saved to
  // the roster AND selected for this shift in one action.
  function quickAddCrew() {
    const name = quickForm.name.trim();
    if(!name) return;
    // If they're already on the roster, just select them — no duplicate row.
    const existing = state.roster.find(m => m.name.toLowerCase() === name.toLowerCase());
    if(existing){
      if(!selectedCrew.find(s=>s.rosterId===existing.id)) setSelectedCrew(prev=>[...prev,{rosterId:existing.id,roleTag:null}]);
      setShowQuickAdd(false); setQuickForm({name:"",position:"",phone:"",email:""});
      return;
    }
    const member = { id: uid(), name, role:"Crew", position: quickForm.position.trim()||"Crew",
      phone: quickForm.phone.trim(), email: quickForm.email.trim(), pin:"",
      available:true, active:true, notes:"", tags:[] };
    persist(prev => ({...prev, roster:[...prev.roster, member]}));
    setSelectedCrew(prev=>[...prev,{rosterId:member.id,roleTag:null}]);
    setShowQuickAdd(false); setQuickForm({name:"",position:"",phone:"",email:""});
  }

  // Unmatched pasted name → create a roster entry on the spot and select it.
  function addUnmatchedToRoster(u) {
    const member = { id: uid(), name: u.name, role: "Crew", position: "Crew", phone: "", email: "", pin: "", available: true, active: true, notes: "", tags: [] };
    persist(prev => ({ ...prev, roster: [...prev.roster, member] }));
    setSelectedCrew(prev => [...prev, { rosterId: member.id, roleTag: u.roleTag || null }]);
    setBriefResult(r => r ? { ...r, matched: [...r.matched, { rosterId: member.id, roleTag: u.roleTag, name: u.name, phone: "" }], unmatched: r.unmatched.filter(x => x !== u) } : r);
  }

  function addCrew(rosterMember) {
    if(selectedCrew.find(s=>s.rosterId===rosterMember.id)) return;
    setSelectedCrew(prev=>[...prev,{rosterId:rosterMember.id, roleTag: null}]);
  }
  function removeCrew(rosterId) {
    setSelectedCrew(prev=>prev.filter(s=>s.rosterId!==rosterId));
  }
  function setCrewTag(rosterId, tag) {
    setSelectedCrew(prev=>prev.map(s=>s.rosterId===rosterId?{...s,roleTag:tag}:s));
  }
  function addCustomTag(tag) {
    persist({...state, customRoleTags:[...(state.customRoleTags||[]),tag]});
  }

  // Bulk email paste: matches roster members by name or email
  function processBulkEmails() {
    const lines = bulkEmails.split(/[\n,;]+/).map(s=>s.trim()).filter(Boolean);
    const matched = [];
    lines.forEach(line => {
      // try matching by email substring or name fragment
      const lower = line.toLowerCase();
      const match = state.roster.find(m =>
        (m.email && m.email.toLowerCase() === lower) ||
        (m.name && m.name.toLowerCase().includes(lower)) ||
        (lower.includes(m.name.toLowerCase().split(" ")[0]))
      );
      if(match && !selectedCrew.find(s=>s.rosterId===match.id) && !matched.find(s=>s.rosterId===match.id)) {
        matched.push({rosterId: match.id, roleTag: null});
      }
    });
    setSelectedCrew(prev => [...prev, ...matched]);
    setBulkEmails("");
    setShowBulkEmail(false);
  }

  function createShift(){
    if(!form.client||!form.date||!form.callTime) return;
    // Convert date YYYY-MM-DD to MM/DD/YYYY for display compatibility
    const [y,m,d] = form.date.split("-");
    const displayDate = `${m}/${d}/${y}`;
    const crew = selectedCrew.map(s=>{
      const r=state.roster.find(m=>m.id===s.rosterId);
      return r?{id:uid(),rosterId:r.id,name:r.name,role:r.role,roleTag:s.roleTag,phone:r.phone||"",email:r.email||"",confirmed:false,confirmedAt:null,declined:false,declinedAt:null,clockIn:null,clockOut:null,absent:false,manualHours:null}:null;
    }).filter(Boolean);
    const reqPos = parseInt(form.requiredPositions) || crew.length || 1;
    const newShift={id:uid(),status:"active",pipelineStatus:null,requiredPositions:reqPos,confirmationRequired:true,...form,date:displayDate,scope:scopeLines.filter(l=>l.trim()),crew,announcements:[],tasks:[],createdAt:now(),lastUpdated:now(),updatedBy:currentUser?.name||""};
    const newShifts=[...state.shifts,newShift];
    // Alert assigned crew right now — not only after the blast step, which
    // managers can get pulled away from before finishing.
    const notifs = crew.length ? [{
      id:uid(), to:"shift", toIds:crew.map(c=>c.rosterId||c.id), shiftId:newShift.id, ts:now(),
      text:`🆕 New shift: ${newShift.client} · ${displayDate} · Call ${newShift.callTime} — open it to confirm.`,
    }, ...state.notifications] : state.notifications;
    persist({...state,shifts:newShifts,notifications:notifs});
    sendSMSPing(crew.map(c=>c.phone),
      `BigCrew: You're on ${newShift.client} · ${displayDate} · Call ${newShift.callTime}. Open the app to confirm.`);
    setActiveShiftId(newShift.id);
    setScreen("message");
  }

  // Get the matching roster object for selectedCrew
  const enrichedSelectedCrew = selectedCrew.map(s => {
    const r = state.roster.find(m=>m.id===s.rosterId);
    return r ? {...r, roleTag:s.roleTag} : null;
  }).filter(Boolean);

  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:C.font,color:C.text}}>
      <style>{GS}</style>
      <PageHeader title="New Shift" sub="Create Shift" onBack={()=>setScreen("home")}/>

      <div className="bcn-body" style={{display:"flex",flexDirection:"column",gap:"12px"}}>
        {/* PASTE & AUTOFILL — the group-text brief managers already write */}
        <div style={{...card({border:"1.5px dashed #E8C84A",background:C.goldBg})}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}
            onClick={()=>setShowBriefPaste(v=>!v)}>
            <div>
              <div style={{fontSize:"12px",color:C.text,fontWeight:"700",letterSpacing:"0.08em"}}>📋 PASTE & AUTOFILL</div>
              <div style={{fontSize:"10px",color:C.muted,marginTop:"2px"}}>Paste your usual crew text — details and crew fill in automatically</div>
            </div>
            <span style={{fontSize:"16px",color:C.text,transform:showBriefPaste?"rotate(180deg)":"rotate(0)",transition:"transform 0.2s"}}>▼</span>
          </div>
          {showBriefPaste && (
            <div style={{marginTop:"12px",paddingTop:"12px",borderTop:`1px solid ${C.border}`}}>
              <textarea value={briefPaste} onChange={e=>setBriefPaste(e.target.value)}
                placeholder={"Paste the shift text you'd normally send, e.g.:\n\nPLEASE CONFIRM!\nDate: 06/28/26\nCall Time: 11pm - 8am\nLocation: Bryant Park New York, NY 10018\nClient: Blue Revolver\nOn site contact:\n Monty\nUniform:\n Big Crew T-shirt black pants\nCREW\n1. Richard B (CC)\n2. Bryan V\nFork ops\n1. Jason Lake"}
                style={{...inp,minHeight:"120px",fontSize:"11px",fontFamily:"monospace",resize:"vertical"}}/>
              <div style={{display:"flex",gap:"8px",marginTop:"8px"}}>
                <button onClick={autofillFromBrief} disabled={!briefPaste.trim()} style={{...btn("gold",true),flex:1,opacity:briefPaste.trim()?1:0.4}}>⚡ AUTOFILL</button>
                <button onClick={()=>{setBriefPaste("");setBriefResult(null);}} style={{...btn("ghost"),padding:"10px 14px",border:`1px solid ${C.border}`}}>✕</button>
              </div>

              {briefResult && (
                <div style={{marginTop:"12px",padding:"12px",background:C.s2,borderRadius:"8px",border:`1px solid ${briefResult.unmatched.length?C.gold:C.green}`}}>
                  <div style={{fontSize:"10px",color:C.green,letterSpacing:"0.1em",fontWeight:"700",marginBottom:"6px"}}>
                    ✓ FILLED {briefResult.filled.length} FIELDS — REVIEW THE FORM BELOW, THEN CREATE
                  </div>
                  {briefResult.matched.length>0 && (
                    <div style={{marginTop:"6px"}}>
                      <div style={{fontSize:"9px",color:C.muted,letterSpacing:"0.08em",marginBottom:"4px"}}>CREW MATCHED TO ROSTER</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:"5px"}}>
                        {briefResult.matched.map(m=>(
                          <span key={m.rosterId} style={{...badge(C.green,C.greenBg),fontSize:"10px"}}>
                            ✓ {m.name}{m.roleTag?` · ${m.roleTag}`:""}{m.phone?` · ${m.phone}`:""}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {briefResult.unmatched.length>0 && (
                    <div style={{marginTop:"10px"}}>
                      <div style={{fontSize:"9px",color:C.red,letterSpacing:"0.08em",marginBottom:"4px"}}>NOT ON ROSTER — TAP TO ADD</div>
                      <div style={{display:"flex",flexDirection:"column",gap:"5px"}}>
                        {briefResult.unmatched.map((u,i)=>(
                          <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 8px",background:C.redBg,borderRadius:"6px"}}>
                            <span style={{fontSize:"11px",color:C.text}}>{u.name}{u.roleTag?` (${u.roleTag})`:""}</span>
                            <button onClick={()=>addUnmatchedToRoster(u)} style={{...btn("gold"),padding:"4px 10px",fontSize:"10px"}}>+ ADD & INCLUDE</button>
                          </div>
                        ))}
                      </div>
                      <div style={{fontSize:"9px",color:C.dim,marginTop:"5px"}}>Added members have no phone number yet — fill it in from the Crew Roster so SMS reaches them.</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={card()}>
          <div style={{fontSize:"11px",color:C.gold,fontWeight:"700",letterSpacing:"0.12em",marginBottom:"12px"}}>SHIFT INFO</div>
          <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
            <div>
              <span style={lbl}>Client *</span>
              <input value={form.client} onChange={e=>setForm(f=>({...f,client:e.target.value}))} placeholder="e.g. Overland" style={{...inp,marginTop:"4px"}}/>
            </div>
            <div>
              <span style={lbl}>Date *</span>
              <input type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))} style={{...inp,marginTop:"4px"}}/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
              <div>
                <span style={lbl}>Call Time *</span>
                <TimeInput value={form.callTime} onChange={v=>setForm(f=>({...f,callTime:v}))} placeholder="3:00 PM"/>
              </div>
              <div>
                <span style={lbl}>End Time</span>
                <TimeInput value={form.endTime} onChange={v=>setForm(f=>({...f,endTime:v}))} placeholder="12:00 AM"/>
              </div>
            </div>
            <div>
              <span style={lbl}>Location</span>
              <input value={form.location} onChange={e=>setForm(f=>({...f,location:e.target.value}))} placeholder="e.g. Spring Studios" style={{...inp,marginTop:"4px"}}/>
            </div>
            <div>
              <span style={lbl}>Address</span>
              <input value={form.address} onChange={e=>setForm(f=>({...f,address:e.target.value}))} placeholder="Full address" style={{...inp,marginTop:"4px"}}/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
              <div>
                <span style={lbl}>Point of Contact</span>
                <input value={form.poc} onChange={e=>setForm(f=>({...f,poc:e.target.value}))} placeholder="Name" style={{...inp,marginTop:"4px"}}/>
              </div>
              <div>
                <span style={lbl}>POC Phone</span>
                <input value={form.pocPhone} onChange={e=>setForm(f=>({...f,pocPhone:e.target.value}))} placeholder="(555) 000-0000" style={{...inp,marginTop:"4px"}}/>
              </div>
            </div>
          </div>
        </div>

        <div style={card()}>
          <div style={{fontSize:"11px",color:C.gold,fontWeight:"700",letterSpacing:"0.12em",marginBottom:"12px"}}>NOTES & UNIFORM</div>
          <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
            <div><span style={lbl}>Crew Notes</span><textarea value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} style={{...inp,minHeight:"70px",resize:"vertical",marginTop:"4px"}}/></div>
            <div><span style={lbl}>Uniform</span><textarea value={form.uniform} onChange={e=>setForm(f=>({...f,uniform:e.target.value}))} style={{...inp,minHeight:"60px",resize:"vertical",marginTop:"4px"}}/></div>
          </div>
        </div>

        <div style={card()}>
          <div style={{fontSize:"11px",color:C.gold,fontWeight:"700",letterSpacing:"0.12em",marginBottom:"12px"}}>SCOPE OF WORK</div>
          <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
            {scopeLines.map((l,i)=>(
              <div key={i} style={{display:"flex",gap:"6px"}}>
                <input value={l} onChange={e=>{const n=[...scopeLines];n[i]=e.target.value;setScopeLines(n);}} placeholder={`Task ${i+1}`} style={{...inp,flex:1}}/>
                {scopeLines.length>1&&<button onClick={()=>setScopeLines(p=>p.filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:C.dim,cursor:"pointer",fontSize:"16px"}}>✕</button>}
              </div>
            ))}
            <button onClick={()=>setScopeLines(p=>[...p,""])} style={{...btn("ghost",true),border:`1px dashed ${C.border}`,padding:"8px",fontSize:"11px"}}>+ Add Task</button>
          </div>
        </div>

        <div style={card()}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"10px",gap:"6px",flexWrap:"wrap"}}>
            <div style={{fontSize:"11px",color:C.gold,fontWeight:"700",letterSpacing:"0.12em"}}>ADD CREW ({selectedCrew.length})</div>
            <div style={{display:"flex",gap:"6px"}}>
              <button onClick={()=>setShowQuickAdd(v=>!v)}
                style={{...btn("ghost"),padding:"5px 10px",fontSize:"9px",border:`1px dashed ${showQuickAdd?C.gold:C.border}`,color:showQuickAdd?C.gold:C.muted}}>
                {showQuickAdd?"✕ CLOSE":"➕ NEW PERSON"}
              </button>
              <button onClick={()=>setShowBulkEmail(!showBulkEmail)}
                style={{...btn("ghost"),padding:"5px 10px",fontSize:"9px",border:`1px dashed ${C.border}`,color:C.muted}}>
                {showBulkEmail?"✕ CLOSE":"📧 BULK PASTE"}
              </button>
            </div>
          </div>

          {/* Quick-add a rookie who isn't on the roster yet — saves to the
              roster (same shape as the Roster screen's add) AND selects them
              for this shift in one tap. */}
          {showQuickAdd && (
            <div style={{...card({background:C.goldBg,border:`1px dashed ${C.gold}`,marginBottom:"10px"})}}>
              <span style={lbl}>➕ New crew member — added to roster + this shift</span>
              <div style={{display:"flex",flexDirection:"column",gap:"8px",marginTop:"8px"}}>
                <input value={quickForm.name} onChange={e=>setQuickForm(f=>({...f,name:e.target.value}))} placeholder="Full name *" style={inp}/>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
                  <input value={quickForm.position} onChange={e=>setQuickForm(f=>({...f,position:e.target.value}))} placeholder="Position (e.g. Stagehand)" style={inp}/>
                  <input value={quickForm.phone} onChange={e=>setQuickForm(f=>({...f,phone:e.target.value}))} placeholder="Phone" inputMode="tel" style={inp}/>
                </div>
                <input value={quickForm.email} onChange={e=>setQuickForm(f=>({...f,email:e.target.value}))} placeholder="Email (optional)" inputMode="email" style={inp}/>
                <div style={{display:"flex",gap:"6px"}}>
                  <button onClick={quickAddCrew} disabled={!quickForm.name.trim()}
                    style={{...btn("gold"),flex:1,opacity:quickForm.name.trim()?1:0.5}}>＋ ADD TO ROSTER & SHIFT</button>
                  <button onClick={()=>{setShowQuickAdd(false);setQuickForm({name:"",position:"",phone:"",email:""});}}
                    style={{...btn("ghost"),padding:"10px 14px",border:`1px solid ${C.border}`}}>CANCEL</button>
                </div>
                {!quickForm.phone.trim() && quickForm.name.trim() && (
                  <div style={{fontSize:"9px",color:C.muted}}>No phone yet — SMS can't reach them until you add one (Roster → their profile).</div>
                )}
              </div>
            </div>
          )}

          {/* Required positions + live fill */}
          <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"12px",padding:"10px 12px",background:C.s2,borderRadius:"8px"}}>
            <div style={{flex:1}}>
              <span style={lbl}>Required Positions</span>
              <div style={{display:"flex",alignItems:"center",gap:"6px",marginTop:"4px"}}>
                <button onClick={()=>setForm(f=>({...f,requiredPositions:String(Math.max(1,(parseInt(f.requiredPositions)||selectedCrew.length||1)-1))}))} style={{...btn("ghost"),padding:"6px 12px",border:`1px solid ${C.border}`,fontSize:"15px"}}>−</button>
                <input type="number" min="1" value={form.requiredPositions} onChange={e=>setForm(f=>({...f,requiredPositions:e.target.value}))} placeholder={String(selectedCrew.length||6)} style={{...inp,width:"60px",textAlign:"center",fontSize:"16px",fontWeight:"700"}}/>
                <button onClick={()=>setForm(f=>({...f,requiredPositions:String((parseInt(f.requiredPositions)||selectedCrew.length||0)+1)}))} style={{...btn("ghost"),padding:"6px 12px",border:`1px solid ${C.border}`,fontSize:"15px"}}>+</button>
              </div>
            </div>
            {(() => {
              const req = parseInt(form.requiredPositions) || selectedCrew.length || 0;
              const filled = selectedCrew.length;
              const open = Math.max(0, req - filled);
              const full = open === 0 && req > 0;
              return (
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:"22px",fontWeight:"700",color:full?C.green:filled===0?C.muted:C.gold,lineHeight:1}}>{filled}/{req}</div>
                  <div style={{fontSize:"9px",color:open>0?C.gold:C.green,letterSpacing:"0.1em",marginTop:"3px"}}>{open>0?`${open} OPEN`:"FILLED ✓"}</div>
                </div>
              );
            })()}
          </div>

          {/* Searchable add */}
          <div style={{marginBottom:"10px"}}>
            <span style={lbl}>Type a name to search the database</span>
            <div style={{marginTop:"6px"}}>
              <SearchableNameDropdown
                options={state.roster}
                onSelect={addCrew}
                excludeIds={selectedCrew.map(s=>s.rosterId)}
                placeholder="Type 2-3 letters of a name…"
                availabilityOf={m => {
                  // The worker's marked availability for the shift's date —
                  // answers "who can work that day?" before assigning.
                  if(!form.date) return null;
                  const a = (state.availability?.[m.id]||{})[form.date];
                  return a && typeof a === "object" ? a.state : a;
                }}
              />
            </div>
          </div>

          {/* Bulk email paste (optional) */}
          {showBulkEmail && (
            <div style={{...card({background:C.blueBg,border:`1px dashed ${C.blue}`,marginBottom:"10px"})}}>
              <span style={lbl}>📧 OPTIONAL — Paste emails or names (one per line or comma-separated)</span>
              <textarea value={bulkEmails} onChange={e=>setBulkEmails(e.target.value)}
                placeholder="khalid@email.com&#10;Bryan&#10;rich.graves@email.com&#10;or comma-separated: khalid, bryan, vlad"
                style={{...inp,marginTop:"6px",minHeight:"80px",resize:"vertical",fontSize:"11px"}}/>
              <div style={{display:"flex",gap:"6px",marginTop:"8px"}}>
                <button onClick={processBulkEmails} disabled={!bulkEmails.trim()} style={{...btn("blue"),flex:1,opacity:bulkEmails.trim()?1:0.5}}>MATCH & ADD</button>
                <button onClick={()=>{setBulkEmails("");setShowBulkEmail(false);}} style={{...btn("ghost"),flex:1,border:`1px solid ${C.border}`}}>CANCEL</button>
              </div>
              <div style={{fontSize:"9px",color:C.muted,marginTop:"6px",lineHeight:"1.5"}}>
                Matches against name (any fragment) or email in the roster. Only matched people are added — unmatched lines are skipped.
              </div>
            </div>
          )}

          {/* Selected crew with role tags */}
          {enrichedSelectedCrew.length>0 ? (
            <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
              {enrichedSelectedCrew.map(m=>{
                // Convert form date (YYYY-MM-DD) to MM/DD/YYYY for conflict check
                const [cy,cm,cd] = (form.date||"").split("-");
                const dispDate = cy ? `${cm}/${cd}/${cy}` : "";
                const conflicts = (dispDate && form.callTime)
                  ? detectConflicts(m.id, dispDate, form.callTime, form.endTime, state.shifts, state.availability, null)
                  : [];
                const highConflict = conflicts.some(c=>c.severity==="high");
                return (
                <div key={m.id} style={{...card({background:C.s2,padding:"10px",border:highConflict?`1px solid ${C.red}`:undefined})}}>
                  <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"8px"}}>
                    <div style={{width:"30px",height:"30px",borderRadius:"7px",background:C.s1,border:`1px solid ${C.borderHi}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"11px",fontWeight:"700",color:C.muted,flexShrink:0}}>{initials(m.name)}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:"13px",fontWeight:"700",color:C.text}}>{m.name}</div>
                      <div style={{fontSize:"9px",color:C.muted,marginTop:"1px"}}>{m.role}</div>
                    </div>
                    {m.role==="Supervisor" && <span style={badge(C.gold,C.goldBg)}>SUP</span>}
                    <button onClick={()=>removeCrew(m.id)} style={{background:"none",border:"none",color:C.dim,cursor:"pointer",fontSize:"14px",padding:"2px 6px"}}>✕</button>
                  </div>
                  {/* Conflict warnings */}
                  {conflicts.length>0 && (
                    <div style={{marginBottom:"8px",display:"flex",flexDirection:"column",gap:"4px"}}>
                      {conflicts.map((c,ci)=>(
                        <div key={ci} style={{
                          display:"flex",alignItems:"center",gap:"6px",fontSize:"10px",
                          padding:"5px 8px",borderRadius:"5px",
                          background: c.severity==="high" ? C.redBg : C.goldBg,
                          color: c.severity==="high" ? C.red : C.gold,
                          border:`1px solid ${c.severity==="high" ? C.red : C.goldDim}`,
                        }}>
                          <span>{c.severity==="high"?"⚠️":"⏳"}</span>
                          <span>{c.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Role tag for this shift */}
                  <div>
                    <div style={{fontSize:"9px",color:C.dim,letterSpacing:"0.1em",marginBottom:"4px"}}>SHIFT ROLE TAG</div>
                    <RoleTagPicker value={m.roleTag} onChange={tag=>setCrewTag(m.id,tag)} customTags={state.customRoleTags||[]} onAddCustom={addCustomTag} compact/>
                  </div>
                </div>
                );
              })}
            </div>
          ) : (
            <div style={{textAlign:"center",color:C.muted,fontSize:"11px",padding:"20px",border:`1px dashed ${C.border}`,borderRadius:"8px"}}>
              No crew added yet. Search above or use bulk paste.
            </div>
          )}
        </div>

        <button onClick={createShift} disabled={!form.client||!form.date||!form.callTime}
          style={{...btn("gold",true),padding:"14px",fontSize:"13px",opacity:(!form.client||!form.date||!form.callTime)?0.5:1}}>
          ✅ CREATE SHIFT
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SCHEDULE (unified Calendar / Week / Availability — both roles)
// ══════════════════════════════════════════════════════════════════════════════
function ScheduleScreen({state, persist, setScreen, currentUser, activeShift, setActiveShiftId, initialView}) {
  const [view, setView] = useState(initialView || "calendar");
  const tabs = [
    {k:"calendar", label:"📅 Calendar"},
    {k:"week", label:"📊 Week"},
    {k:"avail", label:"🗓 Availability"},
  ];
  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:C.font,color:C.text}}>
      <style>{GS}</style>
      <PageHeader title="Schedule" sub={currentUser.role==="manager"?"Calendar · Week · Availability":"Your Schedule"} onBack={()=>setScreen("home")}/>
      <div className="bcn-body" style={{paddingTop:"12px",paddingBottom:0}}>
        <div style={{display:"flex",gap:"4px",background:C.s1,padding:"4px",borderRadius:"8px",border:`1px solid ${C.border}`}}>
          {tabs.map(t=>(
            <button key={t.k} onClick={()=>setView(t.k)} style={{
              flex:1,padding:"9px 6px",fontSize:"11px",fontWeight:"700",letterSpacing:"0.04em",
              background: view===t.k ? "#E8C84A" : "transparent",
              color: view===t.k ? "#1a1400" : C.muted,
              border:"none",borderRadius:"6px",cursor:"pointer",fontFamily:C.font,whiteSpace:"nowrap",
            }}>{t.label}</button>
          ))}
        </div>
      </div>
      {view==="calendar" && <CalendarScreen embedded state={state} persist={persist} setScreen={setScreen} currentUser={currentUser} activeShift={activeShift} setActiveShiftId={setActiveShiftId}/>}
      {view==="week" && <WeekGridScreen embedded state={state} setScreen={setScreen} setActiveShiftId={setActiveShiftId} currentUser={currentUser}/>}
      {view==="avail" && <AvailabilityScreen embedded state={state} persist={persist} setScreen={setScreen} currentUser={currentUser}/>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// GLOBAL SEARCH
// ══════════════════════════════════════════════════════════════════════════════
function SearchScreen({state, setScreen, setActiveShiftId, currentUser}) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const isManager = currentUser?.role==="manager";

  // Crew search only their own world: shifts they're assigned to, no roster
  // browsing — client lists, addresses, and coworker contacts are the
  // manager's data, not something any signed-in worker should mine.
  const searchableShifts = isManager ? state.shifts
    : state.shifts.filter(s => s.crew?.some(c => c.rosterId===currentUser?.id || c.id===currentUser?.id));

  let crew = [], shifts = [], clients = [], locations = [];
  if (query) {
    crew = !isManager ? [] : state.roster.filter(m =>
      m.name.toLowerCase().includes(query) ||
      (m.position||"").toLowerCase().includes(query) ||
      (m.phone||"").includes(query) ||
      (m.email||"").toLowerCase().includes(query)
    );
    shifts = searchableShifts.filter(s =>
      (s.client||"").toLowerCase().includes(query) ||
      (s.location||"").toLowerCase().includes(query) ||
      (s.address||"").toLowerCase().includes(query) ||
      (s.notes||"").toLowerCase().includes(query) ||
      (s.date||"").includes(query)
    );
    const clientSet = new Set();
    searchableShifts.forEach(s => { if((s.client||"").toLowerCase().includes(query)) clientSet.add(s.client); });
    clients = [...clientSet];
    const locSet = new Set();
    searchableShifts.forEach(s => { if((s.location||"").toLowerCase().includes(query) || (s.address||"").toLowerCase().includes(query)) locSet.add(s.location+(s.address?` — ${s.address}`:"")); });
    locations = [...locSet];
  }

  const totalResults = crew.length + shifts.length + clients.length + locations.length;

  function openShift(id){ setActiveShiftId(id); setScreen("shift"); }

  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:C.font,color:C.text}}>
      <style>{GS}</style>
      <PageHeader title="Search" sub={isManager?"Crew · Shifts · Clients · Locations":"Your Shifts"} onBack={()=>setScreen("home")}/>
      <div className="bcn-body" style={{paddingBottom:"80px"}}>
        <input autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder="🔍 Search everything…"
          style={{...inp,fontSize:"15px",padding:"12px 14px",marginBottom:"14px"}}/>

        {!query && (
          <div style={{textAlign:"center",color:C.muted,fontSize:"12px",padding:"40px 20px",lineHeight:"1.6"}}>
            {isManager
              ? <>Search across your entire operation —<br/>crew members, shifts, clients, and locations.</>
              : <>Search your shifts —<br/>by client, location, date, or notes.</>}
          </div>
        )}

        {query && totalResults===0 && (
          <div style={{textAlign:"center",color:C.muted,fontSize:"12px",padding:"40px 20px"}}>No matches for "{q}".</div>
        )}

        {/* Crew */}
        {crew.length>0 && (
          <div style={{marginBottom:"16px"}}>
            <span style={lbl}>👥 Crew ({crew.length})</span>
            <div style={{display:"flex",flexDirection:"column",gap:"6px",marginTop:"8px"}}>
              {crew.map(m=>(
                <div key={m.id} style={{...card({padding:"10px 12px",display:"flex",alignItems:"center",gap:"10px"})}}>
                  <div style={{width:"32px",height:"32px",borderRadius:"7px",background:C.s2,border:`1px solid ${C.borderHi}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"11px",fontWeight:"700",color:C.muted}}>{initials(m.name)}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:"13px",fontWeight:"700"}}>{m.name}</div>
                    <div style={{fontSize:"10px",color:C.muted}}>{m.position||m.role}{m.phone?` · ${m.phone}`:""}</div>
                  </div>
                  {m.phone && <a href={`sms:${m.phone}`} style={{...badge(C.green,C.greenBg),textDecoration:"none"}}>TEXT</a>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Shifts */}
        {shifts.length>0 && (
          <div style={{marginBottom:"16px"}}>
            <span style={lbl}>📅 Shifts ({shifts.length})</span>
            <div style={{display:"flex",flexDirection:"column",gap:"6px",marginTop:"8px"}}>
              {shifts.map(s=>(
                <div key={s.id} onClick={()=>openShift(s.id)} style={{...card({padding:"12px"}),cursor:"pointer"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"6px"}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:"13px",fontWeight:"700"}}>{s.client}</div>
                      <div style={{fontSize:"10px",color:C.muted,marginTop:"2px"}}>{s.date} · {s.callTime}–{s.endTime||"?"}{shiftScheduledHours(s)!=null?` · ${shiftScheduledHours(s)}h`:""} · {s.location}</div>
                    </div>
                    <span style={{color:C.dim}}>›</span>
                  </div>
                  <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
                    <StatusBadge status={deriveShiftStatus(s)} size="sm"/>
                    <FillBadge shift={s} size="sm"/>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Clients */}
        {clients.length>0 && (
          <div style={{marginBottom:"16px"}}>
            <span style={lbl}>🏢 Clients ({clients.length})</span>
            <div style={{display:"flex",flexDirection:"column",gap:"4px",marginTop:"8px"}}>
              {clients.map((c,i)=>{
                // Count within the searcher's visible shifts — crew shouldn't
                // learn a client's total volume from shifts they're not on.
                const count = searchableShifts.filter(s=>s.client===c).length;
                return (
                  <div key={i} style={{...card({padding:"10px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"})}}>
                    <span style={{fontSize:"12px",fontWeight:"700"}}>{c}</span>
                    <span style={{fontSize:"10px",color:C.muted}}>{count} shift{count>1?"s":""}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Locations */}
        {locations.length>0 && (
          <div style={{marginBottom:"16px"}}>
            <span style={lbl}>📍 Locations ({locations.length})</span>
            <div style={{display:"flex",flexDirection:"column",gap:"4px",marginTop:"8px"}}>
              {locations.map((l,i)=>(
                <div key={i} style={{...card({padding:"10px 12px"})}}>
                  <span style={{fontSize:"12px"}}>{l}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// REPORTS (manager)
// ══════════════════════════════════════════════════════════════════════════════
function ReportsScreen({state, setScreen, setActiveShiftId}) {
  const now = new Date();
  const [range, setRange] = useState("week"); // week | month

  const start = new Date(now);
  if (range==="week") { start.setDate(start.getDate() - start.getDay()); }
  else { start.setDate(1); }
  start.setHours(0,0,0,0);
  const end = new Date(start);
  if (range==="week") end.setDate(end.getDate()+7); else end.setMonth(end.getMonth()+1);

  const inRange = state.shifts.filter(s => {
    const d = parseShiftStart(s.date, s.callTime);
    return d && d >= start && d < end;
  });

  let scheduledHours = 0, workedHours = 0, otHours = 0, openPos = 0, pendingConf = 0, completedShifts = 0;
  inRange.forEach(s => {
    const st = parseShiftStart(s.date, s.callTime);
    const en = st ? getShiftEnd(st, s.endTime) : null;
    const dur = (st && en) ? (en - st)/3600000 : 0;
    const f = fillCounts(s);
    scheduledHours += dur * f.assigned;
    openPos += f.open;
    pendingConf += s.crew.filter(c=>!c.confirmed && !c.declined).length;
    s.crew.forEach(c => {
      const h = calcHours(c.clockIn, c.clockOut, c.manualHours);
      workedHours += h.total; otHours += h.ot;
    });
    if (deriveShiftStatus(s, now)==="completed") completedShifts++;
  });

  // Crew utilization (this range)
  const util = state.roster.map(m => {
    let hrs = 0, shifts = 0;
    inRange.forEach(s => {
      // Same id-or-rosterId matching as HoursScreen — matching on rosterId
      // alone made the two screens disagree on legacy crew entries.
      const c = s.crew.find(x=>x.rosterId===m.id || x.id===m.id);
      if (c) { shifts++; hrs += calcHours(c.clockIn,c.clockOut,c.manualHours).total; }
    });
    return {name:m.name, shifts, hrs};
  }).filter(u=>u.shifts>0).sort((a,b)=>b.hrs-a.hrs);

  // Payment tracking (from expenses, this range, by month)
  let totalPaid = 0;
  (state.expenses||[]).forEach(e => {
    const d = new Date(e.date+"T12:00:00");
    if (d>=start && d<end) totalPaid += (e.paid||0);
  });

  const stat = (label,value,color) => (
    <div style={{...card({textAlign:"center",padding:"12px 8px"})}}>
      <div style={{fontSize:"18px",fontWeight:"700",color}}>{value}</div>
      <div style={{fontSize:"8px",color:C.muted,letterSpacing:"0.1em",marginTop:"3px"}}>{label}</div>
    </div>
  );

  const rangeLabel = range==="week"
    ? `Week of ${start.toLocaleDateString([], {month:"short",day:"numeric"})}`
    : start.toLocaleDateString([], {month:"long",year:"numeric"});

  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:C.font,color:C.text}}>
      <style>{GS}</style>
      <PageHeader title="Reports" sub="Operations Analytics" onBack={()=>setScreen("home")}/>
      <div className="bcn-body" style={{paddingBottom:"80px"}}>
        {/* Range toggle */}
        <div style={{display:"flex",gap:"4px",marginBottom:"12px"}}>
          {[{k:"week",l:"This Week"},{k:"month",l:"This Month"}].map(o=>(
            <button key={o.k} onClick={()=>setRange(o.k)} style={{
              flex:1,padding:"8px",fontSize:"11px",fontWeight:"700",letterSpacing:"0.06em",
              background: range===o.k ? "#E8C84A" : "transparent", color: range===o.k ? "#1a1400" : C.muted,
              border:`1px solid ${range===o.k?"#E8C84A":C.border}`,borderRadius:"6px",cursor:"pointer",fontFamily:C.font,
            }}>{o.l}</button>
          ))}
        </div>
        <div style={{fontFamily:C.head,fontSize:"20px",color:C.gold,letterSpacing:"0.06em",marginBottom:"12px"}}>{rangeLabel.toUpperCase()}</div>

        {/* Top stats */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"8px",marginBottom:"10px"}}>
          {stat("SHIFTS", inRange.length, C.gold)}
          {stat("COMPLETED", completedShifts, C.green)}
          {stat("OPEN POS.", openPos, openPos>0?"#F97316":C.green)}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"8px",marginBottom:"16px"}}>
          {stat("SCHED. HRS", fmtHours(scheduledHours), C.blue)}
          {stat("WORKED HRS", fmtHours(workedHours), C.green)}
          {stat("PENDING", pendingConf, pendingConf>0?C.gold:C.green)}
        </div>

        {/* Payment tracking */}
        <div style={{...card({marginBottom:"16px"})}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={lbl}>💵 Payments Logged</span>
            <span style={{fontSize:"18px",fontWeight:"700",color:C.green}}>{"$"+totalPaid.toFixed(2)}</span>
          </div>
          <div style={{fontSize:"9px",color:C.dim,marginTop:"4px"}}>Sum of "amount paid" entries in this range.</div>
        </div>

        {/* Crew utilization */}
        <span style={lbl}>📊 Crew Utilization</span>
        <div style={{display:"flex",flexDirection:"column",gap:"6px",marginTop:"8px",marginBottom:"16px"}}>
          {util.length===0 && <div style={{textAlign:"center",color:C.muted,fontSize:"11px",padding:"16px"}}>No worked hours in this range.</div>}
          {util.map((u,i)=>{
            const maxHrs = util[0].hrs || 1;
            return (
              <div key={i} style={{...card({padding:"10px 12px"})}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:"5px"}}>
                  <span style={{fontSize:"12px",fontWeight:"700"}}>{u.name}</span>
                  <span style={{fontSize:"11px",color:C.gold}}>{fmtHours(u.hrs)} · {u.shifts} shift{u.shifts>1?"s":""}</span>
                </div>
                <div style={{height:"4px",background:C.s2,borderRadius:"3px",overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${(u.hrs/maxHrs)*100}%`,background:"#E8C84A",borderRadius:"3px"}}/>
                </div>
              </div>
            );
          })}
        </div>

        {/* Shift list */}
        <span style={lbl}>📅 Shifts in Range</span>
        <div style={{display:"flex",flexDirection:"column",gap:"6px",marginTop:"8px"}}>
          {inRange.length===0 && <div style={{textAlign:"center",color:C.muted,fontSize:"11px",padding:"16px"}}>No shifts in this range.</div>}
          {inRange.map(s=>(
            <div key={s.id} onClick={()=>{setActiveShiftId(s.id);setScreen("shift");}} style={{...card({padding:"10px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"}),cursor:"pointer"}}>
              <div>
                <div style={{fontSize:"12px",fontWeight:"700"}}>{s.client}</div>
                <div style={{fontSize:"10px",color:C.muted}}>{s.date}</div>
              </div>
              <div style={{display:"flex",gap:"4px",alignItems:"center"}}>
                <FillBadge shift={s} size="sm"/>
                <span style={{color:C.dim}}>›</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ══════════════════════════════════════════════════════════════════════════════
// Segmented control to link consolidated sections (Schedule / Hours & Pay)
function SectionTabs({current, tabs, setScreen}) {
  return (
    <div className="bcn-body" style={{paddingTop:"12px",paddingBottom:0}}>
      <div style={{display:"flex",gap:"4px",background:C.s1,padding:"4px",borderRadius:"8px",border:`1px solid ${C.border}`}}>
        {tabs.map(t=>(
          <button key={t.screen} onClick={()=>t.screen!==current && setScreen(t.screen)} style={{
            flex:1,padding:"8px 6px",fontSize:"11px",fontWeight:"700",letterSpacing:"0.04em",
            background: t.screen===current ? "#E8C84A" : "transparent",
            color: t.screen===current ? "#1a1400" : C.muted,
            border:"none",borderRadius:"6px",cursor:"pointer",fontFamily:C.font,whiteSpace:"nowrap",
          }}>{t.label}</button>
        ))}
      </div>
    </div>
  );
}

function PageHeader({title,sub,onBack}) {
  return (
    <div style={{background:C.s1,borderBottom:`2px solid ${C.gold}`,padding:"14px 14px 12px",position:"sticky",top:0,zIndex:50}}>
      <div style={{display:"flex",alignItems:"center",gap:"12px"}}>
        <button onClick={onBack} style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:"7px",padding:"7px 12px",color:C.muted,cursor:"pointer",fontFamily:C.font,fontSize:"12px",flexShrink:0}}>← Back</button>
        <div style={{overflow:"hidden"}}>
          <div style={{fontFamily:C.head,fontSize:"20px",letterSpacing:"0.08em",color:C.gold,lineHeight:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{title.toUpperCase()}</div>
          <div style={{fontSize:"9px",color:C.muted,letterSpacing:"0.14em",marginTop:"2px"}}>{sub}</div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPENSE TRACKER – 1099 Tax Ledger
// ══════════════════════════════════════════════════════════════════════════════
const IRS_MILEAGE_RATE = 0.70; // 2025/2026 IRS standard mileage rate $/mile
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const CATS = ["General","Food & Meals","Transportation","Supplies","Equipment","Parking","Tolls","Other"];

function fmtMoney(n) { return `$${parseFloat(n||0).toFixed(2)}`; }

// Format one entry in the requested ledger style
// e.g. "3/23 $22.28+$11.86=$34.14 [paid $171.00]"
function fmtLedgerLine(entry) {
  const d = new Date(entry.date + "T12:00:00");
  const dateStr = `${d.getMonth()+1}/${d.getDate()}`;
  const total = entry.items.reduce((a,x)=>a+parseFloat(x||0),0);
  let amtStr;
  if(entry.items.length===1) {
    amtStr = fmtMoney(entry.items[0]);
  } else {
    amtStr = entry.items.map(x=>fmtMoney(x)).join("+") + "=" + fmtMoney(total);
  }
  const paidStr = entry.paid ? ` [paid ${fmtMoney(entry.paid)}]` : " [paid —]";
  const miStr = entry.mileage>0 ? ` | ${entry.mileage}mi` : "";
  return `${dateStr} ${amtStr}${paidStr}${miStr}`;
}

function ExpenseScreen({state, persist, setScreen, currentUser}) {
  const isManager = currentUser.role==="manager";
  const today = new Date();
  const [tab, setTab] = useState("log"); // log | monthly | tax
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [viewUserId] = useState(currentUser.id); // always current user — managers can't see others' tax data
  const [copied, setCopied] = useState(false);

  // NEW ENTRY FORM
  const [form, setForm] = useState({
    date: today.toISOString().slice(0,10),
    items: [""],
    paid: "",
    mileage: "",
    category: "General",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  // Get entries for the viewed user
  const allEntries = (state.expenses||[]).filter(e=>e.userId===viewUserId);

  // Entries for current month view
  const monthEntries = allEntries.filter(e=>{
    const d = new Date(e.date+"T12:00:00");
    return d.getFullYear()===viewMonth_year().y && d.getMonth()===viewMonth_year().m;
  }).sort((a,b)=>a.date.localeCompare(b.date));

  function viewMonth_year() {
    return {y:viewYear, m:viewMonth};
  }

  function addItem() { setForm(f=>({...f,items:[...f.items,""]})); }
  function removeItem(i) { setForm(f=>({...f,items:f.items.filter((_,j)=>j!==i)})); }
  function setItem(i,v) { setForm(f=>{const items=[...f.items];items[i]=v;return {...f,items};}); }

  function saveEntry() {
    const validItems = form.items.filter(x=>x.trim()&&!isNaN(parseFloat(x))).map(x=>parseFloat(x));
    if(!form.date||validItems.length===0) return;
    setSaving(true);
    const entry = {
      id: uid(),
      userId: currentUser.id,
      // Ties the expense to the login account so if this person's roster
      // identity is ever re-matched, their money history follows them.
      accountId: currentUser.accountId || undefined,
      userName: currentUser.name,
      date: form.date,
      items: validItems,
      paid: form.paid?parseFloat(form.paid):0,
      mileage: form.mileage?parseFloat(form.mileage):0,
      category: form.category,
      notes: form.notes,
      ts: now(),
    };
    persist({...state, expenses:[...(state.expenses||[]),entry]});
    setForm({date:today.toISOString().slice(0,10),items:[""],paid:"",mileage:"",category:"General",notes:""});
    setSaving(false);
    setTab("monthly");
    // set month view to entry's month
    const d=new Date(form.date+"T12:00:00");
    setViewMonth(d.getMonth());
    setViewYear(d.getFullYear());
  }

  function deleteEntry(id) {
    persist({...state, expenses:(state.expenses||[]).filter(e=>e.id!==id)});
  }

  // Monthly totals
  function monthTotals(entries) {
    const totalExp = entries.reduce((a,e)=>a+e.items.reduce((b,x)=>b+parseFloat(x||0),0),0);
    const totalPaid = entries.reduce((a,e)=>a+parseFloat(e.paid||0),0);
    const totalMiles = entries.reduce((a,e)=>a+parseFloat(e.mileage||0),0);
    return {totalExp, totalPaid, net:totalPaid-totalExp, totalMiles, mileageDed:totalMiles*IRS_MILEAGE_RATE};
  }

  // Year totals for tax summary
  function yearTotals(year) {
    const yEntries = allEntries.filter(e=>new Date(e.date+"T12:00:00").getFullYear()===year);
    const totalExp = yEntries.reduce((a,e)=>a+e.items.reduce((b,x)=>b+parseFloat(x||0),0),0);
    const totalPaid = yEntries.reduce((a,e)=>a+parseFloat(e.paid||0),0);
    const totalMiles = yEntries.reduce((a,e)=>a+parseFloat(e.mileage||0),0);
    const mileageDed = totalMiles * IRS_MILEAGE_RATE;
    const totalDeductions = totalExp + mileageDed;
    return {totalPaid, totalExp, net:totalPaid-totalExp, totalMiles, mileageDed, totalDeductions, taxableIncome:totalPaid-totalDeductions};
  }

  // Build the copy text for monthly ledger
  function buildMonthCopyText() {
    const label = `${MONTHS[viewMonth]} ${viewYear}`;
    const lines = monthEntries.map(e=>fmtLedgerLine(e));
    const t = monthTotals(monthEntries);
    const miLine = t.totalMiles>0?`\nMileage: ${t.totalMiles} mi (${fmtMoney(t.mileageDed)} deduction @ $${IRS_MILEAGE_RATE}/mi)`:"";
    return `${label}\n${lines.join("\n")}\n─────────────────\nTotal Expenses: ${fmtMoney(t.totalExp)}\nTotal Paid: ${fmtMoney(t.totalPaid)}\nNet Income: ${fmtMoney(t.net)}${miLine}`;
  }

  // Build full year tax report text
  function buildYearCopyText() {
    const yEntries = allEntries.filter(e=>new Date(e.date+"T12:00:00").getFullYear()===viewYear);
    const grouped = {};
    yEntries.forEach(e=>{
      const m=new Date(e.date+"T12:00:00").getMonth();
      if(!grouped[m]) grouped[m]=[];
      grouped[m].push(e);
    });
    let text = `BIGCREW NYC – ${currentUser.name}\n1099-NEC EXPENSE LOG ${viewYear}\n${"═".repeat(40)}\n\n`;
    Object.keys(grouped).sort((a,b)=>parseInt(a)-parseInt(b)).forEach(m=>{
      const entries=grouped[m].sort((a,b)=>a.date.localeCompare(b.date));
      text+=`${MONTHS[parseInt(m)].toUpperCase()}\n`;
      entries.forEach(e=>{text+=fmtLedgerLine(e)+"\n";});
      const t=monthTotals(entries);
      text+=`  Subtotal: Expenses ${fmtMoney(t.totalExp)} | Paid ${fmtMoney(t.totalPaid)} | Net ${fmtMoney(t.net)}\n\n`;
    });
    const yt=yearTotals(viewYear);
    text+=`${"═".repeat(40)}\nYEAR TOTALS ${viewYear}\nGross Income (Paid):    ${fmtMoney(yt.totalPaid)}\nTotal Expenses:         ${fmtMoney(yt.totalExp)}\nMileage: ${yt.totalMiles} mi:       ${fmtMoney(yt.mileageDed)} deduction\nTotal Deductions:       ${fmtMoney(yt.totalDeductions)}\nEst. Taxable Income:    ${fmtMoney(yt.taxableIncome)}\n\n* Mileage rate: $${IRS_MILEAGE_RATE}/mi (IRS standard)\n* Consult a tax professional for exact filing.`;
    return text;
  }

  function copy(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);}).catch(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);});
      } else {
        setCopied(true); setTimeout(()=>setCopied(false),2000);
      }
    } catch(e) { setCopied(true); setTimeout(()=>setCopied(false),2000); }
  }

  const yt = yearTotals(viewYear);

  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:C.font,color:C.text}}>
      <style>{GS}</style>
      <PageHeader title="Expenses & Tax" sub={`${currentUser.name} · 1099-NEC · Private`} onBack={()=>setScreen("home")}/>
      <SectionTabs current="expenses" setScreen={setScreen} tabs={[{label:"⏱ Hours",screen:"hours"},{label:"💰 Expenses & Tax",screen:"expenses"}]}/>

      {/* Privacy banner */}
      <div style={{padding:"10px 14px",background:C.s1,borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:"8px"}}>
        <span style={{fontSize:"14px"}}>🔒</span>
        <div style={{fontSize:"10px",color:C.muted,lineHeight:"1.4"}}>
          <span style={{color:C.green,fontWeight:"700"}}>PRIVATE</span> — Your expense data is only visible to you. Managers cannot access other crew's tax info.
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:"4px",padding:"10px 12px",background:C.s1,borderBottom:`1px solid ${C.border}`}}>
        {["log","monthly","tax"].map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={tabBtn(tab===t)}>
            {t==="log"?"➕ Log":t==="monthly"?"📓 Monthly":"📊 Tax Summary"}
          </button>
        ))}
      </div>

      <div className="bcn-body">

        {/* ── LOG TAB ── */}
        {tab==="log" && (
          <div style={{animation:"fadeUp 0.3s ease",display:"flex",flexDirection:"column",gap:"12px"}}>
            <div style={{background:"rgba(249,115,22,0.1)",border:`1px solid #F97316`,borderRadius:"10px",padding:"12px 14px"}}>
              <div style={{fontSize:"11px",color:"#F97316",fontWeight:"700",letterSpacing:"0.1em",marginBottom:"4px"}}>💡 HOW IT WORKS</div>
              <div style={{fontSize:"11px",color:C.muted,lineHeight:"1.6"}}>Log your expenses for each shift day. Add individual receipt amounts — they'll be shown as an addition (e.g. $22.28+$11.86=$34.14). Enter your <b style={{color:C.text}}>paid</b> amount manually. Everything auto-formats for tax season.</div>
            </div>

            <div style={card()}>
              <div style={{fontSize:"11px",color:"#F97316",fontWeight:"700",letterSpacing:"0.12em",marginBottom:"12px"}}>NEW ENTRY</div>
              <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>

                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
                  <div>
                    <span style={lbl}>Date *</span>
                    <input type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))} style={{...inp,marginTop:"4px"}}/>
                  </div>
                  <div>
                    <span style={lbl}>Category</span>
                    <select value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))} style={{...inp,marginTop:"4px",appearance:"none"}}>
                      {CATS.map(c=><option key={c}>{c}</option>)}
                    </select>
                  </div>
                </div>

                {/* Expense items */}
                <div>
                  <span style={lbl}>Expense Amounts * (one per receipt)</span>
                  <div style={{display:"flex",flexDirection:"column",gap:"6px",marginTop:"6px"}}>
                    {form.items.map((item,i)=>(
                      <div key={i} style={{display:"flex",gap:"6px",alignItems:"center"}}>
                        <span style={{color:C.muted,fontSize:"13px",flexShrink:0}}>$</span>
                        <input type="number" step="0.01" min="0" value={item}
                          onChange={e=>setItem(i,e.target.value)} placeholder="0.00"
                          style={{...inp,flex:1,textAlign:"right"}}/>
                        {form.items.length>1&&(
                          <button onClick={()=>removeItem(i)} style={{background:"none",border:`1px solid ${C.redBg}`,borderRadius:"6px",color:C.red,cursor:"pointer",fontSize:"13px",padding:"6px 10px",fontFamily:C.font}}>✕</button>
                        )}
                      </div>
                    ))}
                    {/* Running total preview */}
                    {form.items.length>1&&(
                      <div style={{textAlign:"right",fontSize:"12px",color:"#F97316",fontWeight:"700"}}>
                        = {fmtMoney(form.items.reduce((a,x)=>a+parseFloat(x||0),0))}
                      </div>
                    )}
                    <button onClick={addItem} style={{...btn("ghost",true),border:`1px dashed ${C.border}`,padding:"8px",fontSize:"11px"}}>+ Add Receipt</button>
                  </div>
                </div>

                {/* Paid */}
                <div>
                  <span style={lbl}>Amount Paid to You (manual) *</span>
                  <div style={{display:"flex",gap:"6px",alignItems:"center",marginTop:"4px"}}>
                    <span style={{color:C.muted,fontSize:"13px",flexShrink:0}}>$</span>
                    <input type="number" step="0.01" min="0" value={form.paid}
                      onChange={e=>setForm(f=>({...f,paid:e.target.value}))} placeholder="0.00"
                      style={{...inp,textAlign:"right",border:`1px solid ${C.green}`,flex:1}}/>
                  </div>
                </div>

                {/* Mileage */}
                <div>
                  <span style={lbl}>Mileage (optional – miles driven)</span>
                  <div style={{display:"flex",gap:"8px",alignItems:"center",marginTop:"4px"}}>
                    <input type="number" step="0.1" min="0" value={form.mileage}
                      onChange={e=>setForm(f=>({...f,mileage:e.target.value}))} placeholder="0"
                      style={{...inp,flex:1,textAlign:"right"}}/>
                    <span style={{fontSize:"11px",color:C.muted,flexShrink:0}}>mi</span>
                    {form.mileage>0&&(
                      <span style={{fontSize:"11px",color:C.green,flexShrink:0}}>= {fmtMoney(parseFloat(form.mileage)*IRS_MILEAGE_RATE)} ded.</span>
                    )}
                  </div>
                  <div style={{fontSize:"9px",color:C.dim,marginTop:"4px"}}>IRS rate ${IRS_MILEAGE_RATE}/mile · deductible for 1099 contractors</div>
                </div>

                {/* Notes */}
                <div>
                  <span style={lbl}>Notes (optional)</span>
                  <input value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="e.g. Spring Studios job" style={{...inp,marginTop:"4px"}}/>
                </div>

                <button onClick={saveEntry}
                  disabled={!form.date||form.items.every(x=>!x.trim())||saving}
                  style={{...btn("gold",true),padding:"13px",fontSize:"12px",opacity:(!form.date||form.items.every(x=>!x.trim()))?0.4:1}}>
                  💾 SAVE ENTRY
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── MONTHLY TAB ── */}
        {tab==="monthly" && (
          <div style={{animation:"fadeUp 0.3s ease"}}>
            {/* Month nav */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"14px"}}>
              <button onClick={()=>{if(viewMonth===0){setViewMonth(11);setViewYear(y=>y-1);}else setViewMonth(m=>m-1);}} style={{...btn("ghost"),padding:"7px 14px",border:`1px solid ${C.border}`}}>‹</button>
              <div style={{fontFamily:C.head,fontSize:"22px",letterSpacing:"0.08em",color:"#F97316"}}>{MONTHS[viewMonth].toUpperCase()} {viewYear}</div>
              <button onClick={()=>{if(viewMonth===11){setViewMonth(0);setViewYear(y=>y+1);}else setViewMonth(m=>m+1);}} style={{...btn("ghost"),padding:"7px 14px",border:`1px solid ${C.border}`}}>›</button>
            </div>

            {monthEntries.length===0 ? (
              <div style={{textAlign:"center",color:C.muted,fontSize:"12px",padding:"40px 0"}}>
                No entries for {MONTHS[viewMonth]}.<br/>
                <span style={{fontSize:"11px"}}>Tap Log to add an entry.</span>
              </div>
            ) : (
              <>
                {/* Ledger display – exact requested format */}
                <div style={{...card({background:C.s2,border:`1px solid ${C.border}`,marginBottom:"12px",padding:"16px"})}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"12px"}}>
                    <div style={{fontFamily:C.head,fontSize:"16px",letterSpacing:"0.08em",color:"#F97316"}}>{MONTHS[viewMonth].toUpperCase()}</div>
                    <button onClick={()=>copy(buildMonthCopyText())} style={{...btn("ghost"),padding:"5px 10px",fontSize:"10px",border:`1px solid ${C.border}`,color:copied?C.green:C.muted}}>
                      {copied?"✓ COPIED":"📋 COPY"}
                    </button>
                  </div>
                  <div style={{fontFamily:"'Courier New',monospace",fontSize:"12px",lineHeight:"2.2",color:C.text}}>
                    {monthEntries.map(e=>(
                      <div key={e.id} style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",borderBottom:`1px solid ${C.border}`,paddingBottom:"6px",marginBottom:"6px",gap:"8px"}}>
                        <div style={{flex:1}}>
                          <span style={{color:"#F97316",fontWeight:"700"}}>{fmtLedgerLine(e)}</span>
                          {e.notes&&<div style={{fontSize:"10px",color:C.dim,marginTop:"2px"}}>  ↳ {e.notes}</div>}
                          {e.mileage>0&&<div style={{fontSize:"10px",color:C.green,marginTop:"1px"}}>  ↳ {e.mileage}mi = {fmtMoney(e.mileage*IRS_MILEAGE_RATE)} tax deduction</div>}
                        </div>
                        <button onClick={()=>deleteEntry(e.id)} style={{background:"none",border:"none",color:C.dim,cursor:"pointer",fontSize:"13px",flexShrink:0,padding:"0 2px"}}>✕</button>
                      </div>
                    ))}
                  </div>
                  {/* Monthly summary line */}
                  {(()=>{
                    const t=monthTotals(monthEntries);
                    return (
                      <div style={{marginTop:"10px",paddingTop:"10px",borderTop:`1px solid ${C.border}`}}>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"6px",textAlign:"center"}}>
                          {[
                            {label:"Expenses",value:fmtMoney(t.totalExp),color:C.red},
                            {label:"Paid",value:fmtMoney(t.totalPaid),color:C.green},
                            {label:"Net",value:fmtMoney(t.net),color:t.net>=0?C.green:C.red},
                          ].map(s=>(
                            <div key={s.label} style={{background:C.s2,borderRadius:"6px",padding:"8px 4px"}}>
                              <div style={{fontSize:"13px",fontWeight:"700",color:s.color}}>{s.value}</div>
                              <div style={{fontSize:"8px",color:C.muted,letterSpacing:"0.12em",marginTop:"2px"}}>{s.label.toUpperCase()}</div>
                            </div>
                          ))}
                        </div>
                        {t.totalMiles>0&&(
                          <div style={{marginTop:"8px",fontSize:"11px",color:C.green,textAlign:"center"}}>
                            🚗 {t.totalMiles} miles · {fmtMoney(t.mileageDed)} mileage deduction
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Individual entry cards (editable view) */}
                <span style={lbl}>Entries This Month</span>
                <div style={{display:"flex",flexDirection:"column",gap:"8px",marginTop:"8px"}}>
                  {monthEntries.map(e=>{
                    const total=e.items.reduce((a,x)=>a+parseFloat(x||0),0);
                    return (
                      <div key={e.id} style={card()}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                          <div style={{flex:1}}>
                            <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"6px"}}>
                              <span style={{fontSize:"13px",fontWeight:"700",color:"#F97316"}}>{new Date(e.date+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span>
                              <span style={badge("#F97316","rgba(249,115,22,0.12)")}>{e.category}</span>
                            </div>
                            {/* Items breakdown */}
                            <div style={{fontFamily:"'Courier New',monospace",fontSize:"12px",color:C.text,marginBottom:"4px"}}>
                              {e.items.length===1
                                ? fmtMoney(e.items[0])
                                : e.items.map(x=>fmtMoney(x)).join(" + ") + " = " + fmtMoney(total)
                              }
                            </div>
                            <div style={{display:"flex",gap:"12px",fontSize:"11px"}}>
                              <span style={{color:C.green}}>💵 Paid: {fmtMoney(e.paid)}</span>
                              {e.mileage>0&&<span style={{color:C.blue}}>🚗 {e.mileage}mi</span>}
                            </div>
                            {e.notes&&<div style={{fontSize:"10px",color:C.muted,marginTop:"4px"}}>📝 {e.notes}</div>}
                          </div>
                          <div style={{textAlign:"right",flexShrink:0}}>
                            <div style={{fontSize:"14px",fontWeight:"700",color:parseFloat(e.paid)-total>=0?C.green:C.red}}>{fmtMoney(parseFloat(e.paid)-total)}</div>
                            <div style={{fontSize:"9px",color:C.muted}}>net</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── TAX SUMMARY TAB ── */}
        {tab==="tax" && (
          <div style={{animation:"fadeUp 0.3s ease"}}>
            {/* Year selector */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"14px"}}>
              <button onClick={()=>setViewYear(y=>y-1)} style={{...btn("ghost"),padding:"7px 14px",border:`1px solid ${C.border}`}}>‹</button>
              <div style={{fontFamily:C.head,fontSize:"26px",letterSpacing:"0.12em",color:"#F97316"}}>{viewYear} TAX YEAR</div>
              <button onClick={()=>setViewYear(y=>y+1)} style={{...btn("ghost"),padding:"7px 14px",border:`1px solid ${C.border}`}}>›</button>
            </div>

            {/* 1099 disclaimer */}
            <div style={{background:"rgba(249,115,22,0.1)",border:`1px solid #F97316`,borderRadius:"10px",padding:"12px 14px",marginBottom:"14px"}}>
              <div style={{fontSize:"10px",color:"#F97316",fontWeight:"700",letterSpacing:"0.12em",marginBottom:"4px"}}>1099-NEC · NEW YORK, NY · SINGLE FILER</div>
              <div style={{fontSize:"11px",color:C.muted,lineHeight:"1.6"}}>
                Estimate covers Federal + NY State + NYC + Self-Employment tax based on <b style={{color:C.text}}>2024 brackets</b>. Brackets change yearly — verify with a CPA before filing. Married/HoH or non-resident filers will see different numbers.
              </div>
            </div>

            {/* Big numbers */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px",marginBottom:"14px"}}>
              {[
                {label:"Gross Income",value:fmtMoney(yt.totalPaid),color:C.green,icon:"💵"},
                {label:"Total Expenses",value:fmtMoney(yt.totalExp),color:C.red,icon:"🧾"},
                {label:"Mileage Deduction",value:fmtMoney(yt.mileageDed),color:C.blue,icon:"🚗"},
                {label:"Net (Taxable)",value:fmtMoney(yt.taxableIncome),color:yt.taxableIncome<=0?C.green:"#F97316",icon:"📊"},
              ].map(s=>(
                <div key={s.label} style={card()}>
                  <div style={{fontSize:"20px",marginBottom:"6px"}}>{s.icon}</div>
                  <div style={{fontSize:"18px",fontWeight:"700",color:s.color}}>{s.value}</div>
                  <div style={{fontSize:"9px",color:C.muted,letterSpacing:"0.12em",marginTop:"3px"}}>{s.label.toUpperCase()}</div>
                </div>
              ))}
            </div>

            {/* DETAILED NYC TAX BREAKDOWN */}
            {yt.totalPaid > 0 && (() => {
              const tax = calcNYCTax(yt.totalPaid, yt.totalExp, yt.mileageDed);
              return (
                <div style={{...card({border:`1.5px solid #F97316`,marginBottom:"14px"})}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"10px"}}>
                    <span style={lbl}>📋 Detailed Tax Breakdown (NYC)</span>
                    <span style={{fontSize:"9px",color:C.dim,letterSpacing:"0.08em"}}>2024 BRACKETS</span>
                  </div>

                  {/* Self-employment tax */}
                  <div style={{marginBottom:"10px",paddingBottom:"10px",borderBottom:`1px solid ${C.border}`}}>
                    <div style={{fontSize:"10px",color:C.muted,letterSpacing:"0.1em",marginBottom:"4px",fontWeight:"700"}}>SELF-EMPLOYMENT TAX</div>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:"11px",padding:"3px 0"}}>
                      <span style={{color:C.muted}}>Social Security (12.4%)</span>
                      <span style={{color:C.text}}>{fmtMoney(tax.seTaxSS)}</span>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:"11px",padding:"3px 0"}}>
                      <span style={{color:C.muted}}>Medicare (2.9%)</span>
                      <span style={{color:C.text}}>{fmtMoney(tax.seTaxMedicare)}</span>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:"12px",padding:"4px 0",fontWeight:"700"}}>
                      <span style={{color:"#F97316"}}>SE Tax Total</span>
                      <span style={{color:"#F97316"}}>{fmtMoney(tax.seTax)}</span>
                    </div>
                    <div style={{fontSize:"9px",color:C.dim,marginTop:"2px"}}>Half is deductible from your federal income tax</div>
                  </div>

                  {/* Income taxes */}
                  <div style={{marginBottom:"10px",paddingBottom:"10px",borderBottom:`1px solid ${C.border}`}}>
                    <div style={{fontSize:"10px",color:C.muted,letterSpacing:"0.1em",marginBottom:"4px",fontWeight:"700"}}>INCOME TAX</div>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:"11px",padding:"3px 0"}}>
                      <span style={{color:C.muted}}>Federal</span>
                      <span style={{color:C.text}}>{fmtMoney(tax.federal)}</span>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:"11px",padding:"3px 0"}}>
                      <span style={{color:C.muted}}>New York State</span>
                      <span style={{color:C.text}}>{fmtMoney(tax.nyState)}</span>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:"11px",padding:"3px 0"}}>
                      <span style={{color:C.muted}}>NYC Resident Tax</span>
                      <span style={{color:C.text}}>{fmtMoney(tax.nyc)}</span>
                    </div>
                  </div>

                  {/* Bottom line */}
                  <div style={{background:"rgba(249,115,22,0.1)",borderRadius:"8px",padding:"12px",marginTop:"10px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"4px"}}>
                      <span style={{fontSize:"12px",color:C.text,fontWeight:"700"}}>TOTAL ESTIMATED TAX</span>
                      <span style={{fontSize:"18px",color:"#F97316",fontWeight:"700"}}>{fmtMoney(tax.totalTax)}</span>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:"10px",color:C.muted,marginBottom:"4px"}}>
                      <span>Effective Rate</span>
                      <span>{(tax.effectiveRate*100).toFixed(1)}%</span>
                    </div>
                    <div style={{height:"1px",background:C.border,margin:"6px 0"}}/>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span style={{fontSize:"11px",color:C.muted}}>Take-home (after tax)</span>
                      <span style={{fontSize:"15px",color:C.green,fontWeight:"700"}}>{fmtMoney(tax.afterTax)}</span>
                    </div>
                  </div>

                  {/* Set aside helper */}
                  <div style={{marginTop:"12px",padding:"10px",background:C.greenBg,border:`1px solid ${C.green}`,borderRadius:"7px"}}>
                    <div style={{fontSize:"10px",color:C.green,letterSpacing:"0.08em",fontWeight:"700",marginBottom:"3px"}}>💡 SUGGESTION</div>
                    <div style={{fontSize:"11px",color:C.text,lineHeight:"1.5"}}>
                      Set aside <b style={{color:C.green}}>{fmtMoney(tax.totalTax/12)}</b>/month or <b style={{color:C.green}}>{(tax.effectiveRate*100).toFixed(0)}%</b> of every payment to cover this.
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* TAX SAVINGS CALCULATOR */}
            <TaxSavingsCalc gross={yt.totalPaid} taxable={yt.taxableIncome}/>

            {/* Monthly breakdown table */}
            <div style={card()}>
              <span style={lbl}>Month-by-Month {viewYear}</span>
              <div style={{marginTop:"8px"}}>
                {MONTHS.map((mName,mi)=>{
                  const mEntries=allEntries.filter(e=>{const d=new Date(e.date+"T12:00:00");return d.getFullYear()===viewYear&&d.getMonth()===mi;});
                  if(mEntries.length===0) return null;
                  const mt=monthTotals(mEntries);
                  return (
                    <div key={mi} onClick={()=>{setTab("monthly");setViewMonth(mi);}} style={{cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
                      <div>
                        <div style={{fontSize:"12px",fontWeight:"700",color:C.text}}>{mName}</div>
                        <div style={{fontSize:"10px",color:C.muted}}>{mEntries.length} entries</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontSize:"12px",color:C.green}}>{fmtMoney(mt.totalPaid)} paid</div>
                        <div style={{fontSize:"10px",color:C.red}}>{fmtMoney(mt.totalExp)} expenses</div>
                      </div>
                    </div>
                  );
                })}
                {allEntries.filter(e=>new Date(e.date+"T12:00:00").getFullYear()===viewYear).length===0&&(
                  <div style={{textAlign:"center",color:C.muted,fontSize:"12px",padding:"20px 0"}}>No entries for {viewYear}.</div>
                )}
              </div>
            </div>

            {/* EXPORT OPTIONS - PDF + Google Doc */}
            <div style={{marginTop:"14px"}}>
              <span style={lbl}>📤 Export Tax Report</span>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px",marginTop:"8px"}}>
                <button onClick={()=>{
                  const tax = yt.totalPaid > 0 ? calcNYCTax(yt.totalPaid, yt.totalExp, yt.mileageDed) : null;
                  let w;
                  try { w = window.open("","_blank","width=800,height=900"); } catch(e) { w = null; }
                  if (!w) {
                    try { navigator.clipboard.writeText(buildYearCopyText()); } catch(e){}
                    setCopied(true); setTimeout(()=>setCopied(false), 2500);
                    return;
                  }
                  w.document.write(buildPrintableReport(viewYear, yt, tax, allEntries, currentUser));
                  w.document.close();
                  setTimeout(()=>{ try { w.print(); } catch(e){} }, 500);
                }} style={{...btn("gold",true),padding:"12px",fontSize:"11px"}}>
                  📄 SAVE AS PDF
                </button>
                <button onClick={async ()=>{
                  // Copy formatted text and open Google Docs blank
                  const text = buildYearCopyText();
                  try {
                    await navigator.clipboard.writeText(text);
                    setCopied(true);
                    setTimeout(()=>setCopied(false), 2500);
                  } catch (e) {/* clipboard not available */}
                  window.open("https://docs.google.com/document/create", "_blank");
                }} style={{...btn("blue",true),padding:"12px",fontSize:"11px"}}>
                  📝 OPEN GOOGLE DOCS
                </button>
              </div>
              <button onClick={()=>copy(buildYearCopyText())} style={{...btn("ghost",true),border:`1px solid ${C.border}`,marginTop:"8px",color:copied?C.green:C.muted,padding:"10px"}}>
                {copied?"✓ COPIED TO CLIPBOARD":"📋 COPY REPORT AS TEXT"}
              </button>
              <div style={{fontSize:"9px",color:C.dim,textAlign:"center",marginTop:"8px",lineHeight:"1.5"}}>
                <b>PDF:</b> opens print dialog → "Save as PDF" (works on all devices).<br/>
                <b>Google Doc:</b> copies text to clipboard, opens blank doc — just paste (Cmd/Ctrl+V).<br/>
                IRS mileage rate: ${IRS_MILEAGE_RATE}/mi · 2024 tax brackets · Single filer
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// TAX SAVINGS CALCULATOR
// ══════════════════════════════════════════════════════════════════════════════
function TaxSavingsCalc({gross, taxable}) {
  const [pct, setPct] = useState(25);
  const presets = [20, 25, 30, 35];
  const baseSavings = (Math.max(0,taxable) * pct / 100);
  const perMonth = baseSavings / 12;
  const perWeek = baseSavings / 52;
  const seTax = Math.max(0,taxable) * 0.153;
  const fedEst = Math.max(0,taxable) * Math.max(0, pct/100 - 0.153);

  return (
    <div style={{...card({marginBottom:"14px",border:`1.5px solid ${C.green}`})}}>
      <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"6px"}}>
        <span style={{fontSize:"18px"}}>💰</span>
        <span style={{...lbl,marginBottom:0,color:C.green}}>Tax Savings Calculator</span>
      </div>
      <div style={{fontSize:"11px",color:C.muted,lineHeight:"1.5",marginBottom:"12px"}}>
        Set aside a portion of every paycheck so tax time doesn't hurt. Common 1099 contractor rule of thumb: 25–30%.
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"6px",marginBottom:"10px"}}>
        {presets.map(p=>(
          <button key={p} onClick={()=>setPct(p)}
            style={{
              padding:"10px 4px",fontSize:"12px",fontWeight:"700",letterSpacing:"0.08em",
              background: pct===p ? C.green : "transparent",
              color: pct===p ? "#000" : C.green,
              border: `1px solid ${C.green}`,borderRadius:"6px",cursor:"pointer",fontFamily:C.font,
            }}>
            {p}%
          </button>
        ))}
      </div>

      <div style={{marginBottom:"10px"}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:"4px",fontSize:"10px",color:C.muted}}>
          <span>Conservative 15%</span>
          <span style={{color:C.green,fontWeight:"700",fontSize:"14px"}}>{pct}%</span>
          <span>Aggressive 40%</span>
        </div>
        <input type="range" min="15" max="40" value={pct} onChange={e=>setPct(parseInt(e.target.value))}
          style={{width:"100%",accentColor:C.green,cursor:"pointer"}}/>
      </div>

      <div style={{background:C.greenBg,border:`1px solid ${C.green}`,borderRadius:"8px",padding:"14px",textAlign:"center",marginBottom:"10px"}}>
        <div style={{fontSize:"32px",fontWeight:"700",color:C.green,lineHeight:1}}>{fmtMoney(baseSavings)}</div>
        <div style={{fontSize:"10px",color:C.muted,letterSpacing:"0.12em",marginTop:"4px"}}>
          SAVE ASIDE ({pct}% OF {fmtMoney(Math.max(0,taxable))} NET)
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px",marginBottom:"12px"}}>
        <div style={{background:C.s2,borderRadius:"6px",padding:"10px",textAlign:"center"}}>
          <div style={{fontSize:"15px",fontWeight:"700",color:C.text}}>{fmtMoney(perMonth)}</div>
          <div style={{fontSize:"9px",color:C.muted,letterSpacing:"0.12em",marginTop:"2px"}}>PER MONTH</div>
        </div>
        <div style={{background:C.s2,borderRadius:"6px",padding:"10px",textAlign:"center"}}>
          <div style={{fontSize:"15px",fontWeight:"700",color:C.text}}>{fmtMoney(perWeek)}</div>
          <div style={{fontSize:"9px",color:C.muted,letterSpacing:"0.12em",marginTop:"2px"}}>PER WEEK</div>
        </div>
      </div>

      <div style={{background:C.s2,borderRadius:"7px",padding:"12px",marginBottom:"10px"}}>
        <div style={{fontSize:"10px",color:C.muted,letterSpacing:"0.1em",marginBottom:"8px"}}>ROUGH BREAKDOWN OF {pct}%</div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:"11px",padding:"4px 0"}}>
          <span style={{color:C.muted}}>Self-employment tax</span>
          <span style={{color:C.text}}>~15.3% ({fmtMoney(seTax)})</span>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:"11px",padding:"4px 0"}}>
          <span style={{color:C.muted}}>Federal + state buffer</span>
          <span style={{color:C.text}}>~{Math.max(0,pct-15.3).toFixed(1)}% ({fmtMoney(fedEst)})</span>
        </div>
      </div>

      <div style={{background:C.goldBg,border:`1px solid ${C.goldDim}`,borderRadius:"6px",padding:"10px"}}>
        <div style={{fontSize:"10px",color:C.gold,fontWeight:"700",marginBottom:"4px",letterSpacing:"0.08em"}}>⚠️ NOT TAX ADVICE</div>
        <div style={{fontSize:"10px",color:C.muted,lineHeight:"1.5"}}>
          A rough guide only. Your actual rate depends on federal bracket, NY state tax, deductions, and other income. <b style={{color:C.text}}>Verify with a CPA.</b> Self-employment tax rate (~15.3% combined Social Security + Medicare) is what I believe is current — please confirm at irs.gov.
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// GOOGLE CALENDAR SETUP GUIDE (modal for managers)
// ══════════════════════════════════════════════════════════════════════════════
function GoogleCalSetupGuide({onClose}) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px"}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.s1,border:`1.5px solid ${C.gold}`,borderRadius:"12px",padding:"24px",maxWidth:"560px",width:"100%",maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"16px"}}>
          <div style={{fontFamily:C.head,fontSize:"22px",letterSpacing:"0.08em",color:C.gold}}>GOOGLE CALENDAR</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:"20px"}}>✕</button>
        </div>

        <div style={{background:C.greenBg,border:`1px solid ${C.green}`,borderRadius:"8px",padding:"12px",marginBottom:"14px"}}>
          <div style={{fontSize:"11px",color:C.green,fontWeight:"700",marginBottom:"4px",letterSpacing:"0.08em"}}>✅ WORKING NOW (NO SETUP)</div>
          <div style={{fontSize:"11px",color:C.text,lineHeight:"1.6"}}>The "📅 Add to Calendar" button on every shift already opens Google Calendar in a new tab with the event pre-filled. Tap → tap "Save" → done. No API keys, no OAuth, no backend.</div>
        </div>

        <div style={{background:C.blueBg,border:`1px solid ${C.blue}`,borderRadius:"8px",padding:"12px",marginBottom:"14px"}}>
          <div style={{fontSize:"11px",color:C.blue,fontWeight:"700",marginBottom:"6px",letterSpacing:"0.08em"}}>🔧 FOR FULL TWO-WAY SYNC (REQUIRES BACKEND)</div>
          <div style={{fontSize:"11px",color:C.text,lineHeight:"1.6",marginBottom:"8px"}}>
            If you want BigCrew to <b>read</b> the manager's existing Google Calendar events (to spot conflicts) and <b>auto-push</b> every shift to their calendar, you need:
          </div>
          <ol style={{fontSize:"11px",color:C.muted,lineHeight:"1.8",paddingLeft:"18px",margin:0}}>
            <li>A Google Cloud project — <span style={{color:C.blue}}>console.cloud.google.com</span> (free)</li>
            <li>Enable the <b style={{color:C.text}}>Google Calendar API</b> in that project</li>
            <li>Create OAuth 2.0 credentials (Client ID + Secret)</li>
            <li>A backend (Firebase / Supabase / Node.js) to handle OAuth tokens</li>
            <li>Hook the BigCrew app to that backend's auth endpoint</li>
          </ol>
          <div style={{fontSize:"10px",color:C.muted,marginTop:"10px",lineHeight:"1.5"}}>
            <b style={{color:C.gold}}>Honest note:</b> I'm not certain of exact dev time, but for an experienced developer this is generally a few hours of OAuth wiring. Firebase has a free tier suitable for small teams.
          </div>
        </div>

        <div style={{background:C.goldBg,border:`1px solid ${C.goldDim}`,borderRadius:"8px",padding:"12px"}}>
          <div style={{fontSize:"11px",color:C.gold,fontWeight:"700",marginBottom:"4px",letterSpacing:"0.08em"}}>💡 RECOMMENDATION</div>
          <div style={{fontSize:"11px",color:C.text,lineHeight:"1.6"}}>For your pitch, the "Add to Calendar" button is more than enough — it's instant and looks polished. Add full OAuth sync once BigCrew commits to deploying. That keeps complexity out of the demo phase.</div>
        </div>

        <button onClick={onClose} style={{...btn("gold",true),marginTop:"16px"}}>GOT IT</button>
      </div>
    </div>
  );
}

// ─── GLOBAL STYLES ───────────────────────────────────────────────────────────
const GS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Bebas+Neue&display=swap');
  * { box-sizing: border-box; }
  ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #f0f0f0; } ::-webkit-scrollbar-thumb { background: #aaa; border-radius:2px; }
  @keyframes fadeUp { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:0.4;} }
  input, select, textarea { font-weight: 600; }
  input::placeholder, textarea::placeholder { color: #aaa; font-weight: 400; }
  a { color: inherit; }
  select option { background: #ffffff; color: #0a0a0a; }
  h1,h2,h3 { font-weight: 900; letter-spacing: -0.01em; }
  strong { font-weight: 900; }
  .bcn-body { padding: 14px 14px 100px; }
  .bcn-row { display: block; }
  .bcn-row-side { display: block; }
  .bcn-nav { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  @media (min-width: 720px) {
    .bcn-body { padding: 24px; max-width: 1100px; margin: 0 auto; }
    .bcn-header-inner { max-width: 1100px; margin: 0 auto; }
    .bcn-nav { grid-template-columns: repeat(4, 1fr); }
    .bcn-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .bcn-row-side { display: grid; grid-template-columns: 1.2fr 1fr; gap: 16px; }
  }
  @media (min-width: 1024px) {
    .bcn-body { max-width: 1200px; }
    .bcn-header-inner { max-width: 1200px; }
  }
`;