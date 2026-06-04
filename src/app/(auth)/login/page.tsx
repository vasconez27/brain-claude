"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Tab = "email" | "pin";

export default function LoginPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function routeAfterLogin() {
    const res = await fetch("/api/auth/session");
    const session = await res.json();
    const role = session?.user?.role;
    router.push(role === "MANAGER" ? "/manager/dashboard" : "/crew/dashboard");
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const result = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (result?.error) { setError("Wrong email or password"); return; }
    routeAfterLogin();
  }

  async function handlePin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const result = await signIn("pin", { pin, redirect: false });
    setLoading(false);
    if (result?.error) { setError("Invalid PIN"); return; }
    routeAfterLogin();
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "#f8f8f8" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap');`}</style>
      <div className="w-full max-w-sm">

        {/* Branding */}
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bigcrewlogo.png" alt="BigCrew NY"
            style={{ width: 72, height: 72, objectFit: "contain", margin: "0 auto 14px" }} />
          <h1 style={{ fontFamily: "'Bebas Neue','Arial Black',sans-serif", fontSize: 30, letterSpacing: "0.12em", color: "#080808" }}>
            BigCrew
          </h1>
          <p style={{ fontSize: 11, color: "#888", letterSpacing: "0.3em", textTransform: "uppercase", marginTop: 4 }}>
            Crew Management
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {error}
            </div>
          )}

          {/* Google */}
          <button
            onClick={() => signIn("google", { callbackUrl: "/post-login" })}
            className="w-full flex items-center justify-center gap-3 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <GoogleIcon />
            Continue with Google
          </button>

          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400">or</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          {/* Tab switcher */}
          <div className="flex gap-1 p-1 bg-gray-100 rounded-lg mb-4">
            {(["email", "pin"] as Tab[]).map(t => (
              <button key={t} onClick={() => { setTab(t); setError(""); }}
                className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  tab === t ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}>
                {t === "email" ? "Email & Password" : "PIN"}
              </button>
            ))}
          </div>

          {tab === "email" && (
            <form onSubmit={handleEmail} className="space-y-3">
              <input
                type="email" placeholder="Email" value={email} required autoComplete="email"
                onChange={e => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
              <input
                type="password" placeholder="Password" value={password} required autoComplete="current-password"
                onChange={e => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
              <button type="submit" disabled={loading}
                className="w-full py-2.5 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-700 disabled:opacity-50 transition-colors">
                {loading ? "Signing in…" : "Sign In"}
              </button>
            </form>
          )}

          {tab === "pin" && (
            <form onSubmit={handlePin} className="space-y-3">
              <input
                type="password" inputMode="numeric" placeholder="Enter PIN"
                value={pin} maxLength={6} required autoFocus
                onChange={e => setPin(e.target.value.replace(/\D/g, ""))}
                className="w-full px-3 py-3 border border-gray-300 rounded-lg text-center text-2xl tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
              <button type="submit" disabled={loading}
                className="w-full py-2.5 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-700 disabled:opacity-50 transition-colors">
                {loading ? "Signing in…" : "Sign In with PIN"}
              </button>
            </form>
          )}

          <p className="mt-5 text-center text-xs text-gray-400">
            No account?{" "}
            <Link href="/register" className="text-gray-900 font-semibold hover:underline">
              Create one
            </Link>
          </p>
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
