import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { format } from "date-fns";

export default async function HoursPage() {
  const session = await getServerSession(authOptions);

  const assignments = await prisma.shiftAssignment.findMany({
    where: {
      userId: session!.user.id,
      status: "CONFIRMED",
    },
    include: {
      shift: {
        select: { title: true, startTime: true, endTime: true, payRate: true, location: true },
      },
    },
    orderBy: { shift: { startTime: "desc" } },
  });

  const totalHours = assignments.reduce((s, a) => {
    const hrs = a.hoursWorked
      ?? (new Date(a.shift.endTime).getTime() - new Date(a.shift.startTime).getTime()) / 3600000;
    return s + hrs;
  }, 0);

  const totalEarned = assignments.reduce((s, a) => {
    const hrs = a.hoursWorked
      ?? (new Date(a.shift.endTime).getTime() - new Date(a.shift.startTime).getTime()) / 3600000;
    return s + hrs * a.shift.payRate;
  }, 0);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thisMonth = assignments.filter(a => new Date(a.shift.startTime) >= monthStart);
  const monthHours = thisMonth.reduce((s, a) => {
    const hrs = a.hoursWorked
      ?? (new Date(a.shift.endTime).getTime() - new Date(a.shift.startTime).getTime()) / 3600000;
    return s + hrs;
  }, 0);

  const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Hours Log</h1>
      <p className="text-gray-500 text-sm mb-6">All confirmed shifts</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="p-5 rounded-xl border bg-blue-50 text-blue-700 border-blue-200">
          <p className="text-3xl font-bold">{totalHours.toFixed(1)}</p>
          <p className="text-sm font-medium mt-1">Total Hours</p>
        </div>
        <div className="p-5 rounded-xl border bg-green-50 text-green-700 border-green-200">
          <p className="text-3xl font-bold">{fmt(totalEarned)}</p>
          <p className="text-sm font-medium mt-1">Total Earned</p>
        </div>
        <div className="p-5 rounded-xl border bg-purple-50 text-purple-700 border-purple-200">
          <p className="text-3xl font-bold">{monthHours.toFixed(1)}</p>
          <p className="text-sm font-medium mt-1">Hours This Month</p>
        </div>
      </div>

      {assignments.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-5xl mb-3">🕐</p>
          <p className="font-medium text-gray-600">No hours logged yet</p>
          <p className="text-sm mt-1">Confirmed shifts will appear here</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Shift</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Hours</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Rate</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Earned</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {assignments.map(a => {
                const hrs = a.hoursWorked
                  ?? (new Date(a.shift.endTime).getTime() - new Date(a.shift.startTime).getTime()) / 3600000;
                const earned = hrs * a.shift.payRate;
                return (
                  <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-900">{a.shift.title}</p>
                      {a.shift.location && <p className="text-xs text-gray-400">{a.shift.location}</p>}
                    </td>
                    <td className="px-5 py-3 text-gray-600">
                      {format(new Date(a.shift.startTime), "MMM d, yyyy")}
                    </td>
                    <td className="px-5 py-3 text-right font-medium text-gray-900">{hrs.toFixed(1)}</td>
                    <td className="px-5 py-3 text-right text-gray-600">${a.shift.payRate}/hr</td>
                    <td className="px-5 py-3 text-right font-semibold text-green-600">{fmt(earned)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200 bg-gray-50">
                <td colSpan={2} className="px-5 py-3 font-semibold text-gray-900">Total</td>
                <td className="px-5 py-3 text-right font-bold text-gray-900">{totalHours.toFixed(1)}</td>
                <td />
                <td className="px-5 py-3 text-right font-bold text-green-600">{fmt(totalEarned)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
