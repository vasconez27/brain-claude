// Runs `prisma db push` during build, but only if a database is configured.
// Without DATABASE_URL the build still succeeds (the app's auth/database
// features just won't work until a database is connected in Vercel).
import { execSync } from "node:child_process";

if (!process.env.DATABASE_URL) {
  console.log("⚠  DATABASE_URL not set — skipping `prisma db push`.");
  console.log("   Create a Postgres database in Vercel → Storage, then redeploy.");
  process.exit(0);
}

try {
  execSync("prisma db push --skip-generate --accept-data-loss", { stdio: "inherit" });
} catch {
  console.error("prisma db push failed — check your DATABASE_URL.");
  process.exit(1);
}

// Seed demo accounts (idempotent — safe to run on every deploy).
try {
  execSync("npx tsx prisma/seed.ts", { stdio: "inherit" });
} catch {
  // Seeding is non-fatal: the build should still succeed without demo data.
  console.warn("⚠  Seed step skipped or failed (non-fatal).");
}
