import { prisma } from "@/lib/prisma";

export default async function RosterPage() {
  const crew = await prisma.user.findMany({
    where: { role: "CREW" },
    include: {
      shiftAssignments: {
        include: { shift: { select: { title: true, startTime: true } } },
        orderBy: { assignedAt: "desc" },
      },
    },
    orderBy: { name: "asc" },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Roster</h1>
      <p className="text-gray-500 text-sm mb-6">{crew.length} crew member{crew.length !== 1 ? "s" : ""}</p>

      {crew.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-5xl mb-3">👥</p>
          <p className="font-medium text-gray-600">No crew yet</p>
          <p className="text-sm mt-1">Crew members sign up at /register</p>
        </div>
      ) : (
        <div className="space-y-3">
          {crew.map(member => {
            const confirmed = member.shiftAssignments.filter(a => a.status === "CONFIRMED").length;
            const pending = member.shiftAssignments.filter(a => a.status === "PENDING").length;
            const declined = member.shiftAssignments.filter(a => a.status === "DECLINED").length;
            const totalHours = member.shiftAssignments.reduce((s, a) => s + (a.hoursWorked ?? 0), 0);
            const confirmRate = member.shiftAssignments.length > 0
              ? Math.round((confirmed / member.shiftAssignments.length) * 100)
              : null;

            return (
              <div key={member.id} className="bg-white border border-gray-200 rounded-xl p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-gray-900 text-base">{member.name}</p>
                    <p className="text-sm text-gray-500">{member.email}</p>
                    {member.phone && <p className="text-sm text-gray-400">{member.phone}</p>}
                    <p className="text-xs text-gray-400 mt-1">
                      Joined {new Date(member.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-semibold text-gray-900">{totalHours.toFixed(1)} hrs</p>
                    <p className="text-xs text-gray-500 mt-0.5">{member.shiftAssignments.length} assignments</p>
                    {confirmRate !== null && (
                      <p className="text-xs font-medium text-green-600 mt-0.5">{confirmRate}% confirm rate</p>
                    )}
                  </div>
                </div>
                {member.shiftAssignments.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-100 flex gap-4 text-xs text-gray-500">
                    <span className="text-green-600 font-medium">{confirmed} confirmed</span>
                    <span className="text-yellow-600 font-medium">{pending} pending</span>
                    {declined > 0 && <span className="text-red-500 font-medium">{declined} declined</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
