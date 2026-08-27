# CrewBrain

Workforce management web app for crews of 1099 independent contractors.
Managers post shifts, assign crew, manage the roster, and send mass SMS.
Crew view their schedule, confirm/decline shifts, track hours, and calculate
1099 taxes.

Built with Next.js 16 (App Router), TypeScript, Prisma + PostgreSQL,
NextAuth, Tailwind, and FullCalendar.

## Quick start (local)

You need **Node.js 20+** and **Docker** (for the PostgreSQL database).

```bash
./scripts/dev-setup.sh   # installs deps, creates .env, starts Postgres, syncs schema
npm run dev              # starts the app
```

Then open **http://localhost:3000** in your browser.

The database starts empty, so create an account first at
**http://localhost:3000/register**:

- **Crew** account — no invite code needed.
- **Manager** account — requires the invite code from `MANAGER_INVITE_CODE`
  in your `.env` (default `let-me-in`).

### Manual setup

If you'd rather not use the script:

```bash
npm install
cp .env.example .env          # then edit values (generate a secret: openssl rand -base64 32)
docker compose up -d db       # or point DATABASE_URL at your own Postgres
npx prisma db push            # create the tables
npm run dev
```

### Note for Claude Code on the web / remote sessions

The dev server binds to `localhost:3000` **inside the remote container**, which
your browser cannot reach directly. To view the app, run it on your own machine
with the steps above, or deploy it. From inside a session, the app can still be
driven and screenshotted programmatically.

## Environment variables

See [`.env.example`](.env.example). `DATABASE_URL` and `NEXTAUTH_SECRET` are
required; Twilio and Google OAuth vars are optional and features degrade
gracefully when they're unset.

## Deploy on Vercel

Set the environment variables from `.env.example` in your Vercel project and
point `DATABASE_URL` at a hosted PostgreSQL instance. `npm run build` runs
`prisma generate` and pushes the schema automatically.
