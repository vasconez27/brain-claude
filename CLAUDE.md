## gstack (recommended)

This project uses [gstack](https://github.com/garrytan/gstack) for AI-assisted workflows.
Install it for the best experience:

```bash
git clone --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
cd ~/.claude/skills/gstack && ./setup --team
```

Skills like /qa, /ship, /review, /investigate, /autoplan, /plan-eng-review, and /browse become available after install.
Use /browse for all web browsing. Use ~/.claude/skills/gstack/... for gstack file paths.

---

## Project: CrewBrain

Workforce management web app for crews of 1099 independent contractors.

### Two user roles

- **Manager** — posts shifts, assigns crew, manages roster, sends mass SMS, views full schedule
- **Crew** — views their assigned schedule, confirms/declines shifts, tracks hours, calculates 1099 taxes

### Tech stack

- **Framework**: Next.js 14 App Router, TypeScript
- **Database**: PostgreSQL + Prisma ORM
- **Auth**: NextAuth.js (credentials + JWT) with role-based routing
- **SMS**: Twilio (mass text to crew)
- **Calendar**: FullCalendar (react)
- **Forms**: React Hook Form + Zod
- **Styles**: Tailwind CSS
- **Tax engine**: `src/lib/tax.ts` — 2024 brackets, SE tax, quarterly estimates

### Key routes

| Path | Description |
|---|---|
| `/` | Landing page |
| `/login` | Sign in (redirects by role) |
| `/register` | Create account (manager requires invite code) |
| `/manager/dashboard` | Stats overview |
| `/manager/shifts` | Create/manage shifts, assign crew |
| `/manager/schedule` | Full calendar view |
| `/manager/roster` | All crew members |
| `/manager/messages` | Send mass SMS |
| `/crew/dashboard` | Upcoming shifts + confirmations |
| `/crew/schedule` | Weekly + calendar view |
| `/crew/hours` | Hours log |
| `/crew/taxes` | 1099 tax calculator + expense tracker |

### API routes

| Endpoint | Methods | Notes |
|---|---|---|
| `/api/auth/[...nextauth]` | GET/POST | NextAuth handler |
| `/api/auth/register` | POST | Create user (role + invite code) |
| `/api/shifts` | GET/POST | List or create shifts |
| `/api/assignments/[id]/confirm` | PATCH | Crew confirms/declines a shift |
| `/api/messages` | GET/POST | Manager sends mass SMS |
| `/api/expenses` | GET/POST | Crew expense tracking |
| `/api/roster` | GET | Manager views all crew |

### Dev setup

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL, NEXTAUTH_SECRET, Twilio creds
npx prisma migrate dev
npm run dev
```
