import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { format } from "date-fns";

export default async function CrewDashboard() {
  const session = await getServerSession(authOptions);

  const now = new Date();
  const weekEnd = new Date(now);
  weekEnd.setDate(now.getDate() + 7);

  const [upcomingAssignments, totalHoursThisMonth, pendingAssignments] = await Promise.all([
    prisma.shiftAssignment.findMany({
      where: {
        userId: session!.user.id,
        status: "CONFIRMED",
        shift: { startTime: { gte: now, lte: weekEnd } },
      },
      include: { shift: true },
      orderBy: { shift: { startTime: "asc" } },
      take: 5,
    }),
    prisma.shiftAssignment.aggregate({
      where: {
        userId: session!.user.id,
        status: "CONFIRMED",
        shift: { startTime: { gte: new Date(now.getFullYear(), now.getMonth(), 1) } },
      },
      _sum: { hoursWorked: true },
    }),
    prisma.shiftAssignment.findMany({
      where: { userId: session!.user.id, status: "PENDING" },
      include: { shift: true },
      orderBy: { shift: { startTime: "asc" } },
      take: 5,
    }),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">My Dashboard</h1>
      <p className="text-gray-500 mb-8">Welcome back, {session?.user.name}</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="p-5 rounded-xl border bg-blue-50 text-blue-700 border-blue-200">
          <p className="text-3xl font-bold">{upcomingAssignments.length}</p>
          <p className="text-sm font-medium mt-1">Shifts This Week</p>
        </div>
        <div className="p-5 rounded-xl border bg-green-50 text-green-700 border-green-200">
          <p className="text-3xl font-bold">{(totalHoursThisMonth._sum.hoursWorked ?? 0).toFixed(1)}</p>
          <p className="text-sm font-medium mt-1">Hours This Month</p>
        </div>
        <div className="p-5 rounded-xl border bg-yellow-50 text-yellow-700 border-yellow-200">
          <p className="text-3xl font-bold">{pendingAssignments.length}</p>
          <p className="text-sm font-medium mt-1">Shifts to Confirm</p>
        </div>
      </div>

      {pendingAssignments.length > 0 && (
        <div className="bg-white rounded-xl border border-yellow-200 p-6 mb-6">
          <h2 className="font-semibold text-gray-900 mb-4">Action Required — Confirm Shifts</h2>
          <div className="space-y-3">
            {pendingAssignments.map((a) => (
              <div key={a.id} className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-gray-900">{a.shift.title}</p>
                  <p className="text-xs text-gray-500">
                    {format(new Date(a.shift.startTime), "EEE, MMM d • h:mm a")} — ${a.shift.payRate}/hr
                  </p>
                </div>
                <Link href="/crew/schedule"
                  className="text-xs font-medium text-blue-600 hover:underline">Review</Link>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-900 mb-4">Upcoming Shifts</h2>
        {upcomingAssignments.length === 0 ? (
          <p className="text-sm text-gray-400">No confirmed shifts in the next 7 days.</p>
        ) : (
          <div className="space-y-3">
            {upcomingAssignments.map((a) => (
              <div key={a.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-gray-900">{a.shift.title}</p>
                  <p className="text-xs text-gray-500">
                    {format(new Date(a.shift.startTime), "EEE, MMM d • h:mm a")}
                    {a.shift.location && ` • ${a.shift.location}`}
                  </p>
                </div>
                <span className="text-xs font-semibold text-green-600">${a.shift.payRate}/hr</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
