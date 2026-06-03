"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SetupPinPage() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!/^\d{4,6}$/.test(pin)) { setError("PIN must be 4–6 digits"); return; }
    if (pin !== confirm) { setError("PINs don't match"); return; }

    setLoading(true);
    const res = await fetch("/api/auth/set-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    setLoading(false);

    if (!res.ok) {
      const d = await res.json();
      setError(d.error ?? "Failed to set PIN");
      return;
    }

    const session = await fetch("/api/auth/session").then(r => r.json());
    const role = session?.user?.role;
    router.push(role === "MANAGER" ? "/manager/dashboard" : "/crew/dashboard");
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "#f8f8f8" }}>
      <div className="w-full max-w-xs">
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bigcrewlogo.png" alt="BigCrew NY" style={{ width: 64, height: 64, objectFit: "contain", margin: "0 auto 14px" }} />
          <h1 style={{ fontFamily: "'Bebas Neue','Arial Black',sans-serif", fontSize: 22, letterSpacing: "0.12em", color: "#080808" }}>
            SET YOUR PIN
          </h1>
          <p style={{ fontSize: 13, color: "#888", marginTop: 6 }}>
            You&apos;ll use this to sign in fast
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Choose a PIN (4–6 digits)
              </label>
              <input
                type="password" inputMode="numeric" placeholder="••••"
                value={pin} maxLength={6} required autoFocus
                onChange={e => setPin(e.target.value.replace(/\D/g, ""))}
                className="w-full px-3 py-3 border border-gray-300 rounded-lg text-center text-2xl tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Confirm PIN
              </label>
              <input
                type="password" inputMode="numeric" placeholder="••••"
                value={confirm} maxLength={6} required
                onChange={e => setConfirm(e.target.value.replace(/\D/g, ""))}
                className="w-full px-3 py-3 border border-gray-300 rounded-lg text-center text-2xl tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
            </div>
            <button
              type="submit" disabled={loading}
              className="w-full py-3 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-700 disabled:opacity-50 transition-colors"
            >
              {loading ? "Saving…" : "Set PIN & Continue"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
