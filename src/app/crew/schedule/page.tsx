"use client";

import { useState, useEffect } from "react";
import { format } from "date-fns";

interface Assignment {
  id: string;
  status: string;
  hoursWorked: number | null;
}

interface Shift {
  id: string;
  title: string;
  location: string | null;
  description: string | null;
  startTime: string;
  endTime: string;
  payRate: number;
  status: string;
  assignments: Assignment[];
}

export default function CrewSchedulePage() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/shifts")
      .then(r => r.json())
      .then(data => {
        setShifts(Array.isArray(data) ? data : []);
        setLoading(false);
      });
  }, []);

  async function respond(assignmentId: string, shiftId: string, status: "CONFIRMED" | "DECLINED") {
    setActing(assignmentId);
    const res = await fetch(`/api/assignments/${assignmentId}/confirm`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      setShifts(prev => prev.map(s =>
        s.id === shiftId
          ? { ...s, assignments: s.assignments.map(a => a.id === assignmentId ? { ...a, status } : a) }
          : s
      ));
    }
    setActing(null);
  }

  const pending = shifts.filter(s => s.assignments[0]?.status === "PENDING");
  const confirmed = shifts.filter(s => s.assignments[0]?.status === "CONFIRMED");
  const declined = shifts.filter(s => s.assignments[0]?.status === "DECLINED");

  const ShiftCard = ({ shift }: { shift: Shift }) => {
    const assignment = shift.assignments[0];
    const hrs = ((new Date(shift.endTime).getTime() - new Date(shift.startTime).getTime()) / 3600000).toFixed(1);
    const est = (shift.payRate * parseFloat(hrs)).toFixed(0);

    return (
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-900 truncate">{shift.title}</p>
            <p className="text-sm text-gray-500 mt-0.5">
              {format(new Date(shift.startTime), "EEE, MMM d · h:mm a")} – {format(new Date(shift.endTime), "h:mm a")}
            </p>
            {shift.location && <p className="text-xs text-gray-400 mt-0.5">{shift.location}</p>}
            <p className="text-sm font-medium text-gray-900 mt-1">
              ${shift.payRate}/hr · {hrs} hrs · est. ${est}
            </p>
          </div>
          {assignment?.status === "PENDING" ? (
            <div className="flex gap-2 shrink-0">
              <button disabled={acting === assignment.id}
                onClick={() => respond(assignment.id, shift.id, "DECLINED")}
                className="px-3 py-1.5 border border-red-200 text-red-600 rounded-lg text-xs font-medium hover:bg-red-50 disabled:opacity-50 transition-colors">
                Decline
              </button>
              <button disabled={acting === assignment.id}
                onClick={() => respond(assignment.id, shift.id, "CONFIRMED")}
                className="px-3 py-1.5 bg-gray-900 text-white rounded-lg text-xs font-semibold hover:bg-gray-700 disabled:opacity-50 transition-colors">
                Confirm
              </button>
            </div>
          ) : (
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium shrink-0 ${
              assignment?.status === "CONFIRMED" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
            }`}>
              {assignment?.status}
            </span>
          )}
        </div>
      </div>
    );
  };

  if (loading) return <div className="text-sm text-gray-400 py-8">Loading schedule…</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">My Schedule</h1>

      {pending.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-yellow-700 uppercase tracking-wide mb-3">
            Action Required — {pending.length}
          </h2>
          <div className="space-y-2">{pending.map(s => <ShiftCard key={s.id} shift={s} />)}</div>
        </section>
      )}

      {confirmed.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-green-700 uppercase tracking-wide mb-3">
            Confirmed — {confirmed.length}
          </h2>
          <div className="space-y-2">{confirmed.map(s => <ShiftCard key={s.id} shift={s} />)}</div>
        </section>
      )}

      {declined.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Declined — {declined.length}
          </h2>
          <div className="space-y-2">{declined.map(s => <ShiftCard key={s.id} shift={s} />)}</div>
        </section>
      )}

      {shifts.length === 0 && (
        <div className="text-center py-20 text-gray-400">
          <p className="text-5xl mb-3">📆</p>
          <p className="font-medium text-gray-600">No shifts assigned yet</p>
          <p className="text-sm mt-1">Your manager will assign you to shifts</p>
        </div>
      )}
    </div>
  );
}
