import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { format } from "date-fns";

const mono = "'DM Mono','Courier New',monospace";
const head = "'Bebas Neue','Arial Black',sans-serif";

export default async function CrewDashboard() {
  const session = await getServerSession(authOptions);
  const now = new Date();
  const weekEnd = new Date(now);
  weekEnd.setDate(now.getDate() + 7);

  const [nextShift, pendingAssignments, allUpcoming] = await Promise.all([
    prisma.shiftAssignment.findFirst({
      where: { userId: session!.user.id, status: "CONFIRMED", shift: { startTime: { gte: now } } },
      include: { shift: true },
      orderBy: { shift: { startTime: "asc" } },
    }),
    prisma.shiftAssignment.findMany({
      where: { userId: session!.user.id, status: "PENDING" },
      include: { shift: true },
      orderBy: { shift: { startTime: "asc" } },
    }),
    prisma.shiftAssignment.findMany({
      where: { userId: session!.user.id, shift: { startTime: { gte: now } } },
      include: { shift: true },
      orderBy: { shift: { startTime: "asc" } },
      take: 8,
    }),
  ]);

  const lbl: React.CSSProperties = { fontFamily: mono, fontSize: 9, color: "#6a6a6a", letterSpacing: "0.2em", textTransform: "uppercase" };
  const card = (extra?: React.CSSProperties): React.CSSProperties => ({
    background: "#151517", border: "1px solid #2c2c30", borderRadius: 10, padding: "14px 16px", ...extra,
  });

  const navCards = [
    { label: "Schedule",     icon: "📅", href: "/crew/schedule",  color: "#60a5fa" },
    { label: "Hours & Pay",  icon: "⏱",  href: "/crew/hours",     color: "#34d399" },
    { label: "Expenses & Tax", icon: "💰", href: "/crew/taxes",   color: "#f97316" },
  ];

  return (
    <div style={{ fontFamily: mono, color: "#ededed" }}>

      {/* Pending confirmation alert */}
      {pendingAssignments.length > 0 && (
        <div style={{ background: "#1e1e10", border: "1px solid #3a3a10", borderRadius: 10, padding: "12px 16px", marginBottom: 14 }}>
          <div style={{ ...lbl, color: "#e8c84a", marginBottom: 6 }}>⚡ Action Required</div>
          {pendingAssignments.map(a => (
            <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#ededed" }}>{a.shift.title}</div>
                <div style={{ fontSize: 10, color: "#9a9a9a", marginTop: 2 }}>
                  {format(new Date(a.shift.startTime), "EEE, MMM d · h:mm a")} · ${a.shift.payRate}/hr
                </div>
              </div>
              <Link href="/crew/schedule" style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.1em", color: "#e8c84a", textDecoration: "none", border: "1px solid #e8c84a", borderRadius: 5, padding: "4px 8px" }}>
                REVIEW →
              </Link>
            </div>
          ))}
        </div>
      )}

      {/* Next shift hero */}
      {nextShift ? (
        <div style={{ background: "linear-gradient(135deg,#1e1e10,#0a0a00)", border: "1.5px solid #e8c84a", borderRadius: 12, padding: "18px 18px 14px", marginBottom: 14 }}>
          <div style={lbl}>Your Next Shift</div>
          <div style={{ fontFamily: head, fontSize: 28, letterSpacing: "0.06em", color: "#e8c84a", lineHeight: 1, marginTop: 6, marginBottom: 4 }}>
            {nextShift.shift.title.toUpperCase()}
          </div>
          <div style={{ fontSize: 11, color: "#9a9a9a" }}>
            {format(new Date(nextShift.shift.startTime), "EEEE, MMMM d · h:mm a")}
            {nextShift.shift.location && ` · 📍 ${nextShift.shift.location}`}
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.12em", background: "#34d39922", color: "#34d399", border: "1px solid #34d39944", borderRadius: 4, padding: "3px 8px" }}>
              CONFIRMED
            </span>
            <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.12em", background: "#1d1d20", color: "#9a9a9a", border: "1px solid #2c2c30", borderRadius: 4, padding: "3px 8px" }}>
              ${nextShift.shift.payRate}/hr
            </span>
          </div>
        </div>
      ) : (
        <div style={{ ...card({ marginBottom: 14, textAlign: "center", padding: "28px 16px" }) }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📭</div>
          <div style={{ fontSize: 12, color: "#6a6a6a" }}>No upcoming confirmed shifts.</div>
        </div>
      )}

      {/* Quick nav grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 14 }}>
        {navCards.map(n => (
          <Link key={n.label} href={n.href} style={{ ...card({ textDecoration: "none", display: "block", padding: "16px 14px", cursor: "pointer" }) }}>
            <div style={{ fontSize: 22, marginBottom: 8 }}>{n.icon}</div>
            <div style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, color: n.color, letterSpacing: "0.08em" }}>{n.label.toUpperCase()}</div>
          </Link>
        ))}
      </div>

      {/* All upcoming shifts */}
      <div style={lbl}>All Shifts</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
        {allUpcoming.length === 0 ? (
          <div style={{ ...card(), fontSize: 11, color: "#6a6a6a" }}>No upcoming shifts assigned.</div>
        ) : allUpcoming.map(a => (
          <div key={a.id} style={{ ...card({ display: "flex", justifyContent: "space-between", alignItems: "center" }) }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#ededed" }}>{a.shift.title}</div>
              <div style={{ fontSize: 10, color: "#9a9a9a", marginTop: 3 }}>
                {format(new Date(a.shift.startTime), "EEE, MMM d · h:mm a")}
                {a.shift.location && ` · ${a.shift.location}`}
              </div>
            </div>
            <span style={{
              fontFamily: mono, fontSize: 9, letterSpacing: "0.12em", borderRadius: 4, padding: "3px 8px",
              background: a.status === "CONFIRMED" ? "#34d39922" : a.status === "DECLINED" ? "#f8717122" : "#e8c84a22",
              color: a.status === "CONFIRMED" ? "#34d399" : a.status === "DECLINED" ? "#f87171" : "#e8c84a",
              border: `1px solid ${a.status === "CONFIRMED" ? "#34d39944" : a.status === "DECLINED" ? "#f8717144" : "#e8c84a44"}`,
            }}>
              {a.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
