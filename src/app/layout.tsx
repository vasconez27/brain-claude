import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { ThemeToggle } from "@/components/ThemeToggle";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "CrewBrain — Workforce Management",
  description: "Crew scheduling, shift management, and 1099 tax tools",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geist.variable} h-full antialiased`}>
      <body className="min-h-full bg-gray-50 text-gray-900 dark:bg-neutral-950 dark:text-gray-100">
        <Providers>
          {children}
          <ThemeToggle />
        </Providers>
      </body>
    </html>
  );
}
