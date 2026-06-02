import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";

export default async function ManagerDashboard() {
  const session = await getServerSession(authOptions);

  const [totalCrew, upcomingShifts, pendingConfirmations, recentMessages] = await Promise.all([
    prisma.user.count({ where: { role: "CREW" } }),
    prisma.shift.count({ where: { startTime: { gte: new Date() }, status: "OPEN" } }),
    prisma.shiftAssignment.count({ where: { status: "PENDING" } }),
    prisma.message.count({ where: { senderId: session!.user.id } }),
  ]);

  const stats = [
    { label: "Total Crew", value: totalCrew, href: "/manager/roster", color: "bg-blue-50 text-blue-700 border-blue-200" },
    { label: "Upcoming Shifts", value: upcomingShifts, href: "/manager/shifts", color: "bg-green-50 text-green-700 border-green-200" },
    { label: "Pending Confirmations", value: pendingConfirmations, href: "/manager/shifts", color: "bg-yellow-50 text-yellow-700 border-yellow-200" },
    { label: "Messages Sent", value: recentMessages, href: "/manager/messages", color: "bg-purple-50 text-purple-700 border-purple-200" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Dashboard</h1>
      <p className="text-gray-500 mb-8">Welcome back, {session?.user.name}</p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}
            className={`p-5 rounded-xl border ${s.color} hover:opacity-90 transition-opacity`}>
            <p className="text-3xl font-bold">{s.value}</p>
            <p className="text-sm font-medium mt-1 opacity-80">{s.label}</p>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Quick Actions</h2>
          </div>
          <div className="space-y-2">
            <Link href="/manager/shifts" className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors group">
              <span className="text-xl">📅</span>
              <div>
                <p className="text-sm font-medium text-gray-900 group-hover:text-blue-600">Post New Shift</p>
                <p className="text-xs text-gray-500">Create and assign a shift to crew members</p>
              </div>
            </Link>
            <Link href="/manager/messages" className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors group">
              <span className="text-xl">📱</span>
              <div>
                <p className="text-sm font-medium text-gray-900 group-hover:text-blue-600">Send Mass Text</p>
                <p className="text-xs text-gray-500">SMS your entire crew or select members</p>
              </div>
            </Link>
            <Link href="/manager/roster" className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors group">
              <span className="text-xl">👥</span>
              <div>
                <p className="text-sm font-medium text-gray-900 group-hover:text-blue-600">View Roster</p>
                <p className="text-xs text-gray-500">Manage your crew members</p>
              </div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
