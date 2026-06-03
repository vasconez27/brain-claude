"use client";

import { useEffect, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";

interface Shift {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  status: string;
  location: string | null;
  payRate: number;
}

export default function SchedulePage() {
  const [events, setEvents] = useState<object[]>([]);
  const [selected, setSelected] = useState<Shift | null>(null);

  useEffect(() => {
    fetch("/api/shifts")
      .then(r => r.json())
      .then((shifts: Shift[]) => {
        if (!Array.isArray(shifts)) return;
        setEvents(shifts.map(s => ({
          id: s.id,
          title: s.title,
          start: s.startTime,
          end: s.endTime,
          backgroundColor:
            s.status === "FILLED" ? "#16a34a"
            : s.status === "CANCELLED" ? "#dc2626"
            : "#111827",
          borderColor: "transparent",
          extendedProps: s,
        })));
      });
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Schedule</h1>

      {selected && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h2 className="font-bold text-gray-900 text-lg mb-3">{selected.title}</h2>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-500">Status</dt>
                <dd className="font-medium text-gray-900">{selected.status}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Start</dt>
                <dd className="text-gray-900">{new Date(selected.startTime).toLocaleString()}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">End</dt>
                <dd className="text-gray-900">{new Date(selected.endTime).toLocaleString()}</dd>
              </div>
              {selected.location && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Location</dt>
                  <dd className="text-gray-900">{selected.location}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-gray-500">Pay Rate</dt>
                <dd className="font-semibold text-gray-900">${selected.payRate}/hr</dd>
              </div>
            </dl>
            <button onClick={() => setSelected(null)}
              className="mt-4 w-full py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">
              Close
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{ left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,timeGridDay" }}
          events={events}
          height={640}
          eventClick={info => setSelected(info.event.extendedProps as Shift)}
          eventDisplay="block"
        />
      </div>
    </div>
  );
}
