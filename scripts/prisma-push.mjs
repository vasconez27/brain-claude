import { execSync } from "node:child_process";

if (!process.env.DATABASE_URL) {
  console.log("⚠  DATABASE_URL not set — skipping prisma db push.");
  process.exit(0);
}

try {
  execSync("prisma db push --skip-generate --accept-data-loss", { stdio: "inherit" });
} catch {
  console.error("prisma db push failed.");
  process.exit(1);
}
