"use client";

import { useState, useEffect } from "react";
import { format } from "date-fns";

interface CrewMember {
  id: string;
  name: string;
  email: string;
  phone?: string;
}

interface Message {
  id: string;
  subject: string | null;
  body: string;
  sentAt: string;
  recipients: string[];
}

export default function MessagesPage() {
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [form, setForm] = useState({ subject: "", body: "", recipientIds: [] as string[] });
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/roster").then(r => r.json()),
      fetch("/api/messages").then(r => r.json()),
    ]).then(([r, m]) => {
      setCrew(Array.isArray(r) ? r : []);
      setMessages(Array.isArray(m) ? m : []);
      setLoading(false);
    });
  }, []);

  function toggleAll() {
    setForm(f => ({
      ...f,
      recipientIds: f.recipientIds.length === crew.length ? [] : crew.map(c => c.id),
    }));
  }

  function toggleCrew(id: string) {
    setForm(f => ({
      ...f,
      recipientIds: f.recipientIds.includes(id)
        ? f.recipientIds.filter(x => x !== id)
        : [...f.recipientIds, id],
    }));
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (form.recipientIds.length === 0) { setError("Select at least one recipient"); return; }
    setSending(true);
    setError("");
    const res = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      const data = await res.json();
      setMessages(prev => [data.message, ...prev]);
      setForm({ subject: "", body: "", recipientIds: [] });
      setSent(true);
      setTimeout(() => setSent(false), 3000);
    } else {
      const d = await res.json();
      setError(d.error ?? "Failed to send");
    }
    setSending(false);
  }

  if (loading) return <div className="text-sm text-gray-400 py-8">Loading…</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Messages</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Compose */}
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Send Mass Text</h2>
          {error && <p className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}
          {sent && <p className="mb-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">Message sent!</p>}
          <form onSubmit={send} className="space-y-3">
            <input placeholder="Subject (optional)" value={form.subject}
              onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            <textarea required placeholder="Message body (max 1600 chars)" rows={4}
              value={form.body} maxLength={1600}
              onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none" />
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-gray-500">Recipients</label>
                <button type="button" onClick={toggleAll}
                  className="text-xs text-blue-600 hover:underline font-medium">
                  {form.recipientIds.length === crew.length ? "Deselect all" : "Select all"}
                </button>
              </div>
              {crew.length === 0 ? (
                <p className="text-sm text-gray-400">No crew members yet.</p>
              ) : (
                <div className="border border-gray-200 rounded-lg p-2 max-h-40 overflow-y-auto space-y-1">
                  {crew.map(c => (
                    <label key={c.id} className="flex items-center gap-2 cursor-pointer text-sm px-1 py-0.5 rounded hover:bg-gray-50">
                      <input type="checkbox" checked={form.recipientIds.includes(c.id)}
                        onChange={() => toggleCrew(c.id)} className="rounded" />
                      <span className="flex-1">{c.name}</span>
                      {c.phone
                        ? <span className="text-xs text-gray-400">{c.phone}</span>
                        : <span className="text-xs text-red-400">no phone</span>}
                    </label>
                  ))}
                </div>
              )}
              {form.recipientIds.length > 0 && (
                <p className="text-xs text-gray-500 mt-1">{form.recipientIds.length} recipient{form.recipientIds.length !== 1 ? "s" : ""} selected</p>
              )}
            </div>
            <button type="submit" disabled={sending || crew.length === 0}
              className="w-full py-2.5 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-700 disabled:opacity-50 transition-colors">
              {sending ? "Sending…" : "Send Text Message"}
            </button>
          </form>
        </div>

        {/* History */}
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Sent Messages</h2>
          {messages.length === 0 ? (
            <p className="text-sm text-gray-400">No messages sent yet.</p>
          ) : (
            <div className="space-y-3 max-h-[480px] overflow-y-auto">
              {messages.map(m => (
                <div key={m.id} className="border border-gray-100 rounded-lg p-3">
                  {m.subject && <p className="text-sm font-semibold text-gray-900 mb-0.5">{m.subject}</p>}
                  <p className="text-sm text-gray-700">{m.body}</p>
                  <div className="flex items-center justify-between mt-2">
                    <p className="text-xs text-gray-400">{m.recipients.length} recipients</p>
                    <p className="text-xs text-gray-400">{format(new Date(m.sentAt), "MMM d, h:mm a")}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
