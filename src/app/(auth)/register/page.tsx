"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Step = "account" | "pin";

const EMPTY = { name: "", email: "", phone: "", password: "", role: "CREW", inviteCode: "" };

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("account");
  const [form, setForm] = useState(EMPTY);
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleAccount(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    // Create account.
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    if (!res.ok) {
      const d = await res.json();
      setError(typeof d.error === "string" ? d.error : "Registration failed");
      setLoading(false);
      return;
    }

    // Auto sign-in so the PIN step can call the authenticated set-pin endpoint.
    const signInResult = await signIn("credentials", {
      email: form.email,
      password: form.password,
      redirect: false,
    });

    setLoading(false);

    if (signInResult?.error) {
      setError("Account created but sign-in failed — go to login.");
      return;
    }

    // Everyone — crew and managers — sets a PIN next, so one account
    // can be signed into by password, PIN, or Google.
    setStep("pin");
  }

  async function handlePin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!/^\d{4,6}$/.test(pin)) { setError("PIN must be 4–6 digits"); return; }
    if (pin !== pinConfirm) { setError("PINs don't match"); return; }

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

    router.push(form.role === "MANAGER" ? "/manager/dashboard" : "/crew/dashboard");
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-[#f8f8f8] dark:bg-neutral-950">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap');`}</style>
      <div className="w-full max-w-sm">

        {/* Branding */}
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bigcrewlogo.png" alt="BigCrew NY" className="dark:invert"
            style={{ width: 72, height: 72, objectFit: "contain", margin: "0 auto 14px" }} />
          <h1 style={{ fontFamily: "'Bebas Neue','Arial Black',sans-serif", fontSize: 30, letterSpacing: "0.12em", color: "var(--foreground)" }}>
            BigCrew
          </h1>
          <p style={{ fontSize: 11, color: "#888", letterSpacing: "0.3em", textTransform: "uppercase", marginTop: 4 }}>
            {step === "account" ? "Create Account" : "Set Your PIN"}
          </p>
        </div>

        <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-gray-200 dark:border-neutral-800 shadow-sm p-6">

          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          {step === "account" && (
            <>
              {/* Google sign-up */}
              <button
                type="button"
                onClick={() => signIn("google", { callbackUrl: "/post-login" })}
                className="w-full flex items-center justify-center gap-3 py-2.5 border border-gray-300 dark:border-neutral-700 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors"
              >
                <GoogleIcon />
                Sign up with Google
              </button>

              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-gray-200 dark:bg-neutral-700" />
                <span className="text-xs text-gray-400">or create account</span>
                <div className="flex-1 h-px bg-gray-200 dark:bg-neutral-700" />
              </div>

              <form onSubmit={handleAccount} className="space-y-3">
                <input
                  type="text" placeholder="Full Name" value={form.name} required
                  onChange={e => set("name", e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-300"
                />
                <input
                  type="email" placeholder="Email" value={form.email} required
                  onChange={e => set("email", e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-300"
                />
                <input
                  type="tel" placeholder="Phone (for SMS)" value={form.phone}
                  onChange={e => set("phone", e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-300"
                />
                <input
                  type="password" placeholder="Password (min 8 chars)" value={form.password} required minLength={8}
                  onChange={e => set("password", e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-300"
                />

                {/* Role */}
                <div className="flex gap-2">
                  {(["CREW", "MANAGER"] as const).map(r => (
                    <button
                      key={r} type="button"
                      onClick={() => set("role", r)}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                        form.role === r
                          ? "bg-gray-900 text-white border-gray-900 dark:bg-white dark:text-gray-900 dark:border-white"
                          : "bg-white text-gray-600 border-gray-300 hover:border-gray-500 dark:bg-neutral-800 dark:text-gray-300 dark:border-neutral-700 dark:hover:border-neutral-500"
                      }`}
                    >
                      {r === "CREW" ? "Crew Member" : "Manager"}
                    </button>
                  ))}
                </div>

                {form.role === "MANAGER" && (
                  <input
                    type="text" placeholder="Manager Access Code" value={form.inviteCode} required
                    onChange={e => set("inviteCode", e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-300 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-300"
                  />
                )}

                <button type="submit" disabled={loading}
                  className="w-full py-2.5 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-700 disabled:opacity-50 transition-colors dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200">
                  {loading ? "Creating…" : "Create Account"}
                </button>
              </form>

              <p className="mt-5 text-center text-xs text-gray-400">
                Already have an account?{" "}
                <Link href="/login" className="text-gray-900 dark:text-gray-100 font-semibold hover:underline">Sign in</Link>
              </p>
            </>
          )}

          {step === "pin" && (
            <>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 text-center">
                Set a quick-access PIN so you can sign in fast next time
              </p>
              <form onSubmit={handlePin} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                    Choose PIN (4–6 digits)
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
                    value={pinConfirm} maxLength={6} required
                    onChange={e => setPinConfirm(e.target.value.replace(/\D/g, ""))}
                    className="w-full px-3 py-3 border border-gray-300 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-100 rounded-lg text-center text-2xl tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-300"
                  />
                </div>
                <button type="submit" disabled={loading}
                  className="w-full py-3 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-700 disabled:opacity-50 transition-colors dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200">
                  {loading ? "Saving…" : "Set PIN & Enter"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.7 4.7-6.2 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.5 6.4 29.5 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5c10.9 0 19.5-7.9 19.5-19.5 0-1.3-.1-2.4-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8c1.8-4.4 6.1-7.5 11.1-7.5 3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.5 6.4 29.5 4.5 24 4.5c-7.7 0-14.4 4.4-17.7 10.7z"/>
      <path fill="#4CAF50" d="M24 43.5c5.4 0 10.3-2.1 14-5.4l-6.5-5.5c-1.9 1.4-4.5 2.4-7.5 2.4-5.1 0-9.4-3.3-11-7.9l-6.6 5.1C9.5 39 16.2 43.5 24 43.5z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.5 5.5c4.6-4.3 7.7-10.6 7.7-18 0-1.3-.1-2.4-.4-3.5z"/>
    </svg>
  );
}
