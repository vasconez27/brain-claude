import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Link from "next/link";

const navLinks = [
  { href: "/manager/dashboard", label: "Dashboard" },
  { href: "/manager/shifts", label: "Shifts" },
  { href: "/manager/schedule", label: "Schedule" },
  { href: "/manager/roster", label: "Roster" },
  { href: "/manager/messages", label: "Messages" },
];

export default async function ManagerLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "MANAGER") redirect("/login");

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 bg-gray-900 text-white flex flex-col">
        <div className="p-5 border-b border-gray-700">
          <p className="font-bold text-lg tracking-wider uppercase">BigCrew NY</p>
          <p className="text-xs text-gray-400 mt-0.5">Manager Portal</p>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {navLinks.map((l) => (
            <Link key={l.href} href={l.href}
              className="block px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="p-4 border-t border-gray-700 text-xs text-gray-400">
          {session.user.name}
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  );
}
