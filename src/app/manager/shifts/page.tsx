"use client";

import { useState, useEffect } from "react";
import { format } from "date-fns";

interface Assignment {
  id: string;
  userId: string;
  status: string;
  user: { name: string; email: string };
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

interface CrewMember {
  id: string;
  name: string;
  email: string;
}

const EMPTY_FORM = { title: "", location: "", description: "", startTime: "", endTime: "", payRate: "", assignTo: [] as string[] };

export default function ShiftsPage() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/shifts").then(r => r.json()),
      fetch("/api/roster").then(r => r.json()),
    ]).then(([s, r]) => {
      setShifts(Array.isArray(s) ? s : []);
      setCrew(Array.isArray(r) ? r : []);
      setLoading(false);
    });
  }, []);

  async function createShift(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const res = await fetch("/api/shifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.title,
        location: form.location || undefined,
        description: form.description || undefined,
        startTime: new Date(form.startTime).toISOString(),
        endTime: new Date(form.endTime).toISOString(),
        payRate: parseFloat(form.payRate),
        assignTo: form.assignTo,
      }),
    });
    if (res.ok) {
      const newShift = await res.json();
      setShifts(prev => [newShift, ...prev]);
      setShowForm(false);
      setForm(EMPTY_FORM);
    } else {
      const d = await res.json();
      setError(d.error ?? "Failed to create shift");
    }
    setSaving(false);
  }

  function toggleCrew(id: string) {
    setForm(f => ({
      ...f,
      assignTo: f.assignTo.includes(id) ? f.assignTo.filter(x => x !== id) : [...f.assignTo, id],
    }));
  }

  const statusBadge = (s: string) => {
    if (s === "OPEN") return "bg-blue-50 text-blue-700 border-blue-200";
    if (s === "FILLED") return "bg-green-50 text-green-700 border-green-200";
    if (s === "CANCELLED") return "bg-red-50 text-red-700 border-red-200";
    return "bg-gray-50 text-gray-600 border-gray-200";
  };

  const confirmColor = (s: string) => {
    if (s === "CONFIRMED") return "text-green-600";
    if (s === "DECLINED") return "text-red-500";
    return "text-yellow-600";
  };

  if (loading) return <div className="text-sm text-gray-400 py-8">Loading shifts…</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Shifts</h1>
          <p className="text-gray-500 text-sm mt-0.5">{shifts.length} total</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-700 transition-colors">
          + New Shift
        </button>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Post New Shift</h2>
            {error && <p className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}
            <form onSubmit={createShift} className="space-y-3">
              <input required placeholder="Shift title (e.g. Load In — Terminal 5)"
                value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              <input placeholder="Location" value={form.location}
                onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Start</label>
                  <input required type="datetime-local" value={form.startTime}
                    onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">End</label>
                  <input required type="datetime-local" value={form.endTime}
                    onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                </div>
              </div>
              <input required placeholder="Pay rate ($/hr)" type="number" min="0" step="0.5"
                value={form.payRate} onChange={e => setForm(f => ({ ...f, payRate: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              <textarea placeholder="Notes (optional)" value={form.description} rows={2}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none" />
              {crew.length > 0 && (
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Assign Crew (optional)</label>
                  <div className="border border-gray-200 rounded-lg p-2 max-h-36 overflow-y-auto space-y-1">
                    {crew.map(c => (
                      <label key={c.id} className="flex items-center gap-2 cursor-pointer text-sm px-1 py-0.5 rounded hover:bg-gray-50">
                        <input type="checkbox" checked={form.assignTo.includes(c.id)}
                          onChange={() => toggleCrew(c.id)} className="rounded" />
                        <span>{c.name}</span>
                        <span className="text-gray-400 text-xs">{c.email}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowForm(false); setError(""); }}
                  className="flex-1 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={saving}
                  className="flex-1 py-2 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-700 disabled:opacity-50 transition-colors">
                  {saving ? "Posting…" : "Post Shift"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {shifts.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-5xl mb-3">📅</p>
          <p className="font-medium text-gray-600">No shifts yet</p>
          <p className="text-sm mt-1">Post your first shift to get started</p>
        </div>
      ) : (
        <div className="space-y-3">
          {shifts.map(shift => (
            <div key={shift.id} className="bg-white border border-gray-200 rounded-xl p-5 hover:border-gray-300 transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900 truncate">{shift.title}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusBadge(shift.status)}`}>
                      {shift.status}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500">
                    {format(new Date(shift.startTime), "EEE, MMM d · h:mm a")} – {format(new Date(shift.endTime), "h:mm a")}
                    {shift.location && <> · {shift.location}</>}
                  </p>
                  <p className="text-sm font-semibold text-gray-900 mt-1">${shift.payRate}/hr</p>
                </div>
                <p className="text-sm text-gray-400 shrink-0">{shift.assignments.length} assigned</p>
              </div>
              {shift.assignments.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-2">
                  {shift.assignments.map(a => (
                    <span key={a.id} className="text-xs px-2.5 py-1 bg-gray-100 rounded-full font-medium">
                      <span className="text-gray-700">{a.user.name}</span>
                      <span className={`ml-1 ${confirmColor(a.status)}`}>· {a.status}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
