import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { format } from "date-fns";

const mono = "'DM Mono','Courier New',monospace";
const head = "'Bebas Neue','Arial Black',sans-serif";

export default async function ManagerDashboard() {
  const session = await getServerSession(authOptions);
  const now = new Date();

  const [totalCrew, upcomingShifts, pendingConfirmations, recentShifts] = await Promise.all([
    prisma.user.count({ where: { role: "CREW" } }),
    prisma.shift.count({ where: { startTime: { gte: now }, status: "OPEN" } }),
    prisma.shiftAssignment.count({ where: { status: "PENDING" } }),
    prisma.shift.findMany({
      where: { startTime: { gte: now } },
      orderBy: { startTime: "asc" },
      take: 6,
      include: { _count: { select: { assignments: true } } },
    }),
  ]);

  const lbl: React.CSSProperties = { fontFamily: mono, fontSize: 9, color: "#6a6a6a", letterSpacing: "0.2em", textTransform: "uppercase" };
  const card = (extra?: React.CSSProperties): React.CSSProperties => ({
    background: "#151517", border: "1px solid #2c2c30", borderRadius: 10, padding: "14px 16px", ...extra,
  });

  const stats = [
    { label: "Total Crew",    value: totalCrew,            color: "#60a5fa", href: "/manager/roster" },
    { label: "Open Shifts",   value: upcomingShifts,       color: "#34d399", href: "/manager/shifts" },
    { label: "Pending Confirms", value: pendingConfirmations, color: "#e8c84a", href: "/manager/shifts" },
  ];

  const navCards = [
    { label: "Post Shift",    icon: "📅", href: "/manager/shifts",   color: "#34d399" },
    { label: "Schedule",      icon: "🗓", href: "/manager/schedule", color: "#60a5fa" },
    { label: "Roster",        icon: "👥", href: "/manager/roster",   color: "#a78bfa" },
    { label: "Blast Message", icon: "📨", href: "/manager/messages", color: "#f87171" },
  ];

  return (
    <div style={{ fontFamily: mono, color: "#ededed" }}>

      {/* Greeting */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: head, fontSize: 28, letterSpacing: "0.08em", color: "#ededed", lineHeight: 1 }}>
          MANAGER PORTAL
        </div>
        <div style={{ fontSize: 10, color: "#6a6a6a", letterSpacing: "0.12em", marginTop: 6 }}>
          WELCOME BACK, {session?.user.name?.toUpperCase()}
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 14 }}>
        {stats.map(s => (
          <Link key={s.label} href={s.href} style={{ ...card({ textDecoration: "none", display: "block" }) }}>
            <div style={{ fontFamily: head, fontSize: 34, color: s.color, lineHeight: 1 }}>{s.value}</div>
            <div style={{ ...lbl, marginTop: 6 }}>{s.label}</div>
          </Link>
        ))}
      </div>

      {/* Pending alert */}
      {pendingConfirmations > 0 && (
        <div style={{ background: "#1e1e10", border: "1px solid #3a3a10", borderRadius: 10, padding: "12px 16px", marginBottom: 14 }}>
          <div style={{ ...lbl, color: "#e8c84a" }}>⚡ {pendingConfirmations} crew confirmation{pendingConfirmations > 1 ? "s" : ""} pending</div>
          <Link href="/manager/shifts" style={{ fontFamily: mono, fontSize: 10, color: "#e8c84a", textDecoration: "none", marginTop: 4, display: "inline-block" }}>
            View shifts →
          </Link>
        </div>
      )}

      {/* Quick nav grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 16 }}>
        {navCards.map(n => (
          <Link key={n.label} href={n.href} style={{ ...card({ textDecoration: "none", display: "block", padding: "16px 14px", cursor: "pointer" }) }}>
            <div style={{ fontSize: 22, marginBottom: 8 }}>{n.icon}</div>
            <div style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, color: n.color, letterSpacing: "0.08em" }}>{n.label.toUpperCase()}</div>
          </Link>
        ))}
      </div>

      {/* Upcoming shifts list */}
      <div style={lbl}>Upcoming Shifts</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
        {recentShifts.length === 0 ? (
          <div style={{ ...card(), fontSize: 11, color: "#6a6a6a" }}>No upcoming shifts. Post one to get started.</div>
        ) : recentShifts.map(s => (
          <Link key={s.id} href="/manager/shifts" style={{ ...card({ display: "flex", justifyContent: "space-between", alignItems: "center", textDecoration: "none" }) }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#ededed" }}>{s.title}</div>
              <div style={{ fontSize: 10, color: "#9a9a9a", marginTop: 3 }}>
                {format(new Date(s.startTime), "EEE, MMM d · h:mm a")}
                {s.location && ` · 📍 ${s.location}`}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.12em", color: "#34d399", background: "#34d39922", border: "1px solid #34d39944", borderRadius: 4, padding: "3px 8px" }}>
                {s._count.assignments} CREW
              </div>
              <div style={{ fontSize: 10, color: "#9a9a9a", marginTop: 4 }}>${s.payRate}/hr</div>
            </div>
          </Link>
        ))}

        <Link href="/manager/shifts" style={{ ...card({ textDecoration: "none", textAlign: "center", background: "transparent", border: "1px dashed #2c2c30", padding: "12px", fontSize: 11, color: "#6a6a6a" }) }}>
          + POST NEW SHIFT
        </Link>
      </div>
    </div>
  );
}
