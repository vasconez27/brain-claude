import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Link from "next/link";
import { SignOutButton } from "@/components/SignOutButton";

const navLinks = [
  { href: "/crew/dashboard", label: "Dashboard",      icon: "⬛" },
  { href: "/crew/schedule",  label: "My Schedule",    icon: "📅" },
  { href: "/crew/hours",     label: "Hours & Pay",    icon: "⏱" },
  { href: "/crew/taxes",     label: "Expenses & Tax", icon: "💰" },
];

const sideStyle: React.CSSProperties = {
  width: 220,
  minHeight: "100vh",
  background: "#0c0c0d",
  borderRight: "1px solid #2c2c30",
  display: "flex",
  flexDirection: "column",
  fontFamily: "'DM Mono','Courier New',monospace",
};

export default async function CrewLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "CREW") redirect("/login");

  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "#0c0c0d" }}>
      <aside style={sideStyle}>
        {/* Brand */}
        <div style={{ padding: "20px 16px 14px", borderBottom: "1px solid #2c2c30" }}>
          <div style={{ fontFamily: "'Bebas Neue','Arial Black',sans-serif", fontSize: 22, letterSpacing: "0.1em", color: "#ededed", lineHeight: 1 }}>
            BIGCREW NYC
          </div>
          <div style={{ fontSize: 9, color: "#6a6a6a", letterSpacing: "0.2em", marginTop: 4 }}>
            CREW PORTAL
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: "12px 10px" }}>
          {navLinks.map((l) => (
            <Link key={l.href} href={l.href} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "9px 10px", borderRadius: 7, marginBottom: 2,
              fontSize: 11, letterSpacing: "0.06em", color: "#9a9a9a",
              textDecoration: "none", transition: "color 0.15s, background 0.15s",
            }}
              className="hover:bg-[#1d1d20] hover:!text-[#ededed]"
            >
              <span style={{ fontSize: 14 }}>{l.icon}</span>
              {l.label.toUpperCase()}
            </Link>
          ))}
        </nav>

        {/* Footer */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid #2c2c30" }}>
          <div style={{ fontSize: 10, color: "#6a6a6a", marginBottom: 8, letterSpacing: "0.06em" }}>
            {session.user.name?.toUpperCase()}
          </div>
          <SignOutButton />
        </div>
      </aside>

      <main style={{ flex: 1, overflowY: "auto", padding: 28, background: "#0c0c0d" }}>
        {children}
      </main>
    </div>
  );
}
