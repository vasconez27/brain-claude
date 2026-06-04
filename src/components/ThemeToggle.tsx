"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";

// Floating sun/moon button — flips the whole app between light and dark.
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch — theme is only known on the client.
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  // Hide the toggle on the ENTER / landing page.
  if (pathname === "/") return null;

  const dark = theme === "dark";

  return (
    <button
      type="button"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="fixed bottom-5 right-5 z-50 flex h-11 w-11 items-center justify-center rounded-full border border-gray-300 bg-white text-lg shadow-md transition-colors hover:bg-gray-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-100 dark:hover:bg-neutral-700"
    >
      {dark ? "☀" : "☾"}
    </button>
  );
}
