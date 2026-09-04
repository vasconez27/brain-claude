# Deploying CrewBrain

This gets CrewBrain onto a permanent URL you can open from any device.

**Stack:** [Vercel](https://vercel.com) (hosting) + [Neon](https://neon.tech) (serverless PostgreSQL). Both have free tiers that comfortably fit this app.

The `build` script already runs `prisma db push`, so your database tables are created automatically on the first deploy — no manual migration step.

---

## 1. Create a hosted database (Neon)

1. Sign up at https://neon.tech (free).
2. Create a new project (name it e.g. `crewbrain`, pick a region near you).
3. On the project dashboard, copy the **connection string**. It looks like:
   ```
   postgresql://USER:PASSWORD@ep-xxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require
   ```
   Use the **pooled** connection string (the host contains `-pooler`) — it's the right one for serverless.

> Supabase works too: create a project, then Project Settings → Database → Connection string (URI), and use the connection **pooler** URI.

---

## 2. Push this repo to GitHub

It already lives at `vasconez27/brain-claude`. Make sure your latest branch is pushed (this guide is on the `claude/app-recovery-s6pl0k` branch).

---

## 3. Deploy on Vercel

1. Sign up / log in at https://vercel.com with your GitHub account.
2. **Add New → Project**, then import the `brain-claude` repo.
3. Framework preset should auto-detect **Next.js**. Leave build/output settings at their defaults.
4. Before clicking Deploy, open **Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | your Neon pooled connection string from step 1 |
   | `NEXTAUTH_SECRET` | a long random string — generate with `openssl rand -base64 32` |
   | `NEXTAUTH_URL` | leave blank for now, fill in after first deploy (see below) |
   | `MANAGER_INVITE_CODE` | the code required to create manager accounts (e.g. `BALLIN`) |
   | `TWILIO_ACCOUNT_SID` | *(optional — only for mass SMS)* |
   | `TWILIO_AUTH_TOKEN` | *(optional)* |
   | `TWILIO_PHONE_NUMBER` | *(optional, e.g. `+15551234567`)* |

5. Click **Deploy**. First build takes ~2 min and will create your tables in Neon.

### Set `NEXTAUTH_URL`
After the first deploy, Vercel gives you a URL like `https://brain-claude.vercel.app`.
1. Go to **Settings → Environment Variables**, set `NEXTAUTH_URL` to that exact URL.
2. **Redeploy** (Deployments → ⋯ → Redeploy) so auth picks it up.

Login/session cookies won't work correctly until `NEXTAUTH_URL` matches your real domain.

---

## 4. First login

Open your Vercel URL and go to `/register`:
- **Manager** account: requires the `MANAGER_INVITE_CODE` you set.
- **Crew** accounts: no code needed.

---

## Local development

```bash
npm install
# start a local Postgres and create a db, then:
cp .env.example .env   # or create .env with the vars from step 3
npx prisma db push
npm run dev            # http://localhost:3000
```

---

## Notes

- **`prisma db push` on every deploy:** the build uses `db push --accept-data-loss`, which is
  fine for early development but can drop columns if the schema changes destructively. Once the
  schema stabilizes, switch to versioned migrations (`prisma migrate deploy`) for safety.
- **Twilio** is only needed for the manager mass-SMS feature. Everything else works without it.
- **Custom domain:** add one under Vercel **Settings → Domains**, then update `NEXTAUTH_URL`
  to the custom domain and redeploy.
