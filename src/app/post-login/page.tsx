"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Landing page after Google OAuth. Anyone without a PIN sets one first.
export default function PostLogin() {
  const router = useRouter();

  useEffect(() => {
    fetch("/api/auth/profile")
      .then(r => r.json())
      .then(({ role, hasPIN }) => {
        if (!role) { router.replace("/login"); return; }
        // Everyone sets a PIN on first sign-in — crew and managers alike.
        if (!hasPIN) { router.replace("/setup-pin"); return; }
        router.replace(role === "MANAGER" ? "/manager/dashboard" : "/crew/dashboard");
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#f8f8f8" }}>
      <p className="text-sm text-gray-400 tracking-widest uppercase">Signing you in…</p>
    </div>
  );
}
