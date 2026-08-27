# Putting CrewBrain on the internet (Vercel)

Follow these in order. Takes about 20 minutes. Both accounts are free.

---

## Step 1 — Make the database (Neon)

The app stores shifts, crew, and invoices in a database. It needs to live
online so every phone sees the same data.

1. Go to **neon.com** and sign up (free).
2. Create a project. Name it `crewbrain`.
3. It shows you a **connection string**. It looks like:
   `postgresql://user:password@ep-something.aws.neon.tech/neondb?sslmode=require`
4. **Copy it.** You'll paste it in Step 3.

---

## Step 2 — Put the app on Vercel

1. Go to **vercel.com** and sign up with **GitHub**.
2. Click **Add New → Project**.
3. Find `brain-claude` in the list and click **Import**.
4. Pick the branch to deploy (see "Which branch" at the bottom).
5. **Do not click Deploy yet** — do Step 3 first.

---

## Step 3 — Paste in the settings

Still on the import screen, open **Environment Variables**.
Add these one at a time (Name on the left, Value on the right):

| Name | Value |
|---|---|
| `DATABASE_URL` | the Neon string from Step 1 |
| `NEXTAUTH_SECRET` | the long random key you generated |
| `MANAGER_INVITE_CODE` | any password you pick, e.g. `bigcrew2026` |

Leave `NEXTAUTH_URL` out for now — Vercel sets its own URL automatically.

Now click **Deploy**. Wait ~2 minutes.

---

## Step 4 — Lock in the web address

When it finishes, Vercel gives you a link like
`https://brain-claude.vercel.app`.

1. Copy that link.
2. Go to **Settings → Environment Variables**.
3. Add `NEXTAUTH_URL` = that link (no slash at the end).
4. Go to **Deployments**, click the newest one, and hit **Redeploy**.

This step matters — logging in breaks without it.

---

## Step 5 — Make your account

1. Open your link and go to `/register`.
2. Make a **Manager** account — it asks for the invite code you set
   in `MANAGER_INVITE_CODE`.
3. Crew members register at the same page. They do **not** need a code.

The database starts empty. Your manager account is the first one in.

---

## Step 6 (optional) — Turn on text messages

Only if you want mass SMS to crew.

1. Sign up at **twilio.com** and buy a phone number (~$1/month).
2. Add three more environment variables in Vercel:
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_PHONE_NUMBER`  (like `+15551234567`)
3. Redeploy.

Skip this and everything else still works — texting is just off.

---

## Which branch to deploy

- `claude/gstack-repo-j92aH` — the main project
- `claude/app-setup-aeo6ja` — same thing plus local setup files

Either works. Whichever you pick, set it as the Production Branch under
**Settings → Git**.

---

## Important warnings

- **Never change `NEXTAUTH_SECRET` after people sign up.** Crew PINs are
  scrambled using it. Changing it locks everyone out.
- **Never put the Neon string or the secret in the code.** Only in Vercel's
  Environment Variables screen. Anything committed to GitHub is visible.
- Pushing new commits to your production branch redeploys the site
  automatically.

---

## If something breaks

- **Build failed** → open the Vercel build log, read the last red lines.
- **Can't log in** → `NEXTAUTH_URL` is missing or wrong (Step 4).
- **Errors about the database** → `DATABASE_URL` is wrong, or you left off
  `?sslmode=require` at the end.
