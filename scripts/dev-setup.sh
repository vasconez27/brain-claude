#!/usr/bin/env bash
# One-command local setup for CrewBrain.
#   ./scripts/dev-setup.sh
# Then: npm run dev  ->  http://localhost:3000
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Installing dependencies"
npm install

if [ ! -f .env ]; then
  echo "==> Creating .env from .env.example"
  cp .env.example .env
  if command -v openssl >/dev/null 2>&1; then
    secret=$(openssl rand -base64 32)
    # Replace the placeholder secret with a generated one (portable sed).
    tmp=$(mktemp)
    sed "s|replace-me-with-a-random-secret|${secret}|" .env > "$tmp" && mv "$tmp" .env
    echo "    Generated NEXTAUTH_SECRET"
  fi
else
  echo "==> .env already exists, leaving it untouched"
fi

echo "==> Starting PostgreSQL"
if command -v docker >/dev/null 2>&1; then
  docker compose up -d db
  echo "    Waiting for database to accept connections..."
  for _ in $(seq 1 30); do
    if docker compose exec -T db pg_isready -U postgres >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
else
  echo "    Docker not found. Start a PostgreSQL 16 server yourself and make sure"
  echo "    DATABASE_URL in .env points to it, then re-run this script."
  exit 1
fi

echo "==> Syncing database schema"
npx prisma db push

echo
echo "Done. Start the app with:"
echo "    npm run dev"
echo "Then open http://localhost:3000"
