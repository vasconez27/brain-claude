"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PostLogin() {
  const router = useRouter();

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((session) => {
        const role = session?.user?.role;
        if (role === "MANAGER") router.replace("/manager/dashboard");
        else if (role === "CREW") router.replace("/crew/dashboard");
        else router.replace("/login");
      });
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-sm text-gray-400">Signing you in…</p>
    </div>
  );
}
