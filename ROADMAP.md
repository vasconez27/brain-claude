# BigCrew — Manager Dashboard Roadmap

Parked ideas, queued for future build (in priority order).

## 1. Shift pipeline status board (Kanban)
A single board view to move shifts through stages: **Draft → Filled → In Progress → Complete**.
Right now status is derived per-shift and scattered across screens. One drag/tap board
would give the manager a clear pipeline at a glance.

## 2. Crew availability calendar (manager view)
Before assigning crew, the manager should see who is actually available on a given day.
The data model already exists (`state.availability` keyed by rosterId + date), but there's
no manager-facing view of it. Surface it inside the crew-assignment flow.

## 3. Crew invite link
Manager generates a link → crew member opens it, registers, and is auto-added to the roster
(no manual roster entry). Ties into the auth flow (`/register`) + the shared workspace roster.

## 4. Push / SMS confirmation reminders
Auto-blast "you haven't confirmed yet" to crew with PENDING status N hours before a shift.
Builds on the existing blast/notification pipeline + Twilio.

---

## Done
- Cleared demo seed data — live system starts empty.
- Wired dashboard to shared Postgres workspace (all devices see the same schedule).
- Fixed Admin panel + Blast Message blank-screen when no shift exists.
- Manager blast now reliably posts to the shift + notifies crew.
