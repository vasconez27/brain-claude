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
    <div className="min-h-screen flex items-center justify-center px-4 bg-[#f8f8f8] dark:bg-neutral-950">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap');`}</style>
      <div className="w-full max-w-xs">
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bigcrewlogo.png" alt="BigCrew NY" className="dark:invert" style={{ width: 64, height: 64, objectFit: "contain", margin: "0 auto 14px" }} />
          <h1 style={{ fontFamily: "'Bebas Neue','Arial Black',sans-serif", fontSize: 30, letterSpacing: "0.12em", color: "var(--foreground)" }}>
            BigCrew
          </h1>
          <p className="text-gray-500 dark:text-gray-400" style={{ fontSize: 11, letterSpacing: "0.3em", textTransform: "uppercase", marginTop: 4 }}>
            Set Your PIN
          </p>
        </div>

        <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-gray-200 dark:border-neutral-800 shadow-sm p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg text-sm text-red-600 dark:text-red-400">{error}</div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                Choose a PIN (4–6 digits)
              </label>
              <input
                type="password" inputMode="numeric" placeholder="••••"
                value={pin} maxLength={6} required autoFocus
                onChange={e => setPin(e.target.value.replace(/\D/g, ""))}
                className="w-full px-3 py-3 border border-gray-300 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-100 rounded-lg text-center text-2xl tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-300"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                Confirm PIN
              </label>
              <input
                type="password" inputMode="numeric" placeholder="••••"
                value={confirm} maxLength={6} required
                onChange={e => setConfirm(e.target.value.replace(/\D/g, ""))}
                className="w-full px-3 py-3 border border-gray-300 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-100 rounded-lg text-center text-2xl tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-300"
              />
            </div>
            <button
              type="submit" disabled={loading}
              className="w-full py-3 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-700 disabled:opacity-50 transition-colors dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
            >
              {loading ? "Saving…" : "Set PIN & Continue"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
