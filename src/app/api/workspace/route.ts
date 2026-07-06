import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// One shared workspace document for the whole company.
const WORKSPACE_ID = "main";

type Rec = Record<string, unknown>;

// Does a roster tombstone match this account? Tombstones are written when a
// manager deletes someone: {userId, linkedUserIds, email, name}.
function tombstoned(tombs: unknown, u: { id: string; name: string | null; email: string | null }): boolean {
  if (!Array.isArray(tombs)) return false;
  const emailLc = (u.email ?? "").toLowerCase();
  const nameLc = (u.name ?? "").toLowerCase();
  return tombs.some((t: Rec) =>
    t.userId === u.id ||
    (Array.isArray(t.linkedUserIds) && (t.linkedUserIds as string[]).includes(u.id)) ||
    (emailLc && typeof t.email === "string" && t.email.toLowerCase() === emailLc) ||
    (nameLc && typeof t.name === "string" && t.name.toLowerCase() === nameLc)
  );
}

// GET — return the saved dashboard state, with every registered CREW account
// merged into the roster so new sign-ups show up automatically (in the admin
// roster and the shift crew picker) without the manager adding them by hand.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ws = await prisma.workspace.findUnique({ where: { id: WORKSPACE_ID } });
  const data: Rec = (ws?.data as Rec) ?? {};

  const crewUsers = await prisma.user.findMany({
    where: { role: "CREW" },
    select: { id: true, name: true, email: true, phone: true },
    orderBy: { name: "asc" },
  });

  // Merge: add any crew account missing from the roster; refresh identity fields
  // on existing ones while preserving manager-set fields (position, tags, notes,
  // active/archived state).
  const roster: Rec[] = Array.isArray(data.roster) ? [...(data.roster as Rec[])] : [];

  // Accounts the manager explicitly removed from the roster — don't re-add
  // them. Legacy `removedUserIds` (bare ids) and current `removedIdentities`
  // (tombstone objects) are both honored: this merge silently resurrecting
  // deleted crew on every load was half of the "deleted people come back" bug.
  const removedLegacy = new Set(
    (Array.isArray(data.removedUserIds) ? data.removedUserIds : [])
      .map((x: unknown) => (typeof x === "string" ? x : (x as { id?: string })?.id))
      .filter(Boolean) as string[]
  );

  for (const u of crewUsers) {
    if (removedLegacy.has(u.id)) continue;
    if (tombstoned(data.removedIdentities, u)) continue;
    const emailLc = (u.email ?? "").toLowerCase();
    const idx = roster.findIndex(r =>
      r.userId === u.id ||
      r.id === u.id ||
      (Array.isArray(r.linkedUserIds) && (r.linkedUserIds as string[]).includes(u.id)) ||
      (emailLc && typeof r.email === "string" && r.email.toLowerCase() === emailLc)
    );
    if (idx === -1) {
      roster.push({
        id: u.id, userId: u.id, name: u.name,
        role: "Crew", position: "Crew",
        phone: u.phone ?? "", email: u.email ?? "",
        available: true, active: true, notes: "", tags: [], source: "account",
      });
    } else {
      const r = roster[idx];
      roster[idx] = {
        ...r,
        userId: (r.userId as string) || u.id,
        name: u.name,
        email: u.email ?? r.email ?? "",
        phone: (r.phone as string) || u.phone || "",
      };
    }
  }

  return NextResponse.json({ data: { ...data, roster }, updatedAt: ws?.updatedAt ?? null });
}

// Crew-entry fields a crew member may write on a shift (their own responses
// and hours; a Crew Captain may also submit hours for the whole crew).
const CREW_SELF_FIELDS = [
  "confirmed", "confirmedAt", "declined", "declinedAt",
  "clockIn", "clockOut", "manualHours", "adjustReason",
] as const;

// Restricted merge for non-manager saves: start from the server's current
// data and accept only the slices a crew member legitimately writes. A crew
// session can no longer wipe the roster, delete shifts, or rewrite briefs.
function mergeCrewWrite(server: Rec, client: Rec, ownIds: Set<string>, accountId: string): Rec {
  const merged: Rec = { ...server };

  // Shifts: same set as the server; per shift accept crew-entry self-service
  // fields, CC hours submission flags, and task toggles.
  const clientShifts = new Map(
    (Array.isArray(client.shifts) ? (client.shifts as Rec[]) : []).map(s => [s.id, s])
  );
  merged.shifts = (Array.isArray(server.shifts) ? (server.shifts as Rec[]) : []).map(ss => {
    const cs = clientShifts.get(ss.id);
    if (!cs) return ss;
    const clientCrew = new Map(
      (Array.isArray(cs.crew) ? (cs.crew as Rec[]) : []).map(c => [c.id, c])
    );
    const crew = (Array.isArray(ss.crew) ? (ss.crew as Rec[]) : []).map(sc => {
      const cc = clientCrew.get(sc.id);
      if (!cc) return sc;
      const isOwn = ownIds.has(sc.rosterId as string) || ownIds.has(sc.id as string);
      const ccSubmitting = Boolean(cs.ccHoursSubmitted);
      if (!isOwn && !ccSubmitting) return sc;
      const upd: Rec = { ...sc };
      for (const f of CREW_SELF_FIELDS) if (f in cc) upd[f] = cc[f];
      return upd;
    });
    return {
      ...ss,
      crew,
      tasks: Array.isArray(cs.tasks) ? cs.tasks : ss.tasks,
      ccHoursSubmitted: cs.ccHoursSubmitted ?? ss.ccHoursSubmitted,
      ccSubmittedBy: cs.ccSubmittedBy ?? ss.ccSubmittedBy,
      ccSubmittedAt: cs.ccSubmittedAt ?? ss.ccSubmittedAt,
      lastUpdated: cs.lastUpdated ?? ss.lastUpdated,
      updatedBy: cs.updatedBy ?? ss.updatedBy,
    };
  });

  // Availability: accept only the crew member's own keys.
  const serverAvail = (server.availability as Rec) ?? {};
  const clientAvail = (client.availability as Rec) ?? {};
  const avail: Rec = { ...serverAvail };
  for (const id of ownIds) if (id in clientAvail) avail[id] = clientAvail[id];
  merged.availability = avail;

  // Expenses: others' entries come from the server; own entries come from the
  // client (add/edit/delete own only).
  const owns = (e: Rec) => ownIds.has(e.userId as string) || e.accountId === accountId;
  const serverExp = Array.isArray(server.expenses) ? (server.expenses as Rec[]) : [];
  const clientExp = Array.isArray(client.expenses) ? (client.expenses as Rec[]) : [];
  merged.expenses = [...serverExp.filter(e => !owns(e)), ...clientExp.filter(owns)];

  // Notifications: additions only (confirm/decline raises manager alerts) —
  // a crew save can't erase existing ones. Newest first, same 60 cap.
  const serverNotifs = Array.isArray(server.notifications) ? (server.notifications as Rec[]) : [];
  const known = new Set(serverNotifs.map(n => n.id));
  const added = (Array.isArray(client.notifications) ? (client.notifications as Rec[]) : [])
    .filter(n => !known.has(n.id));
  merged.notifications = [...added, ...serverNotifs].slice(0, 60);

  // Roster: keep the server's; accept updates to own entries' identity fields
  // (login backfill) and self-registration appends bound to this account.
  const clientRoster = Array.isArray(client.roster) ? (client.roster as Rec[]) : [];
  const serverRoster = Array.isArray(server.roster) ? (server.roster as Rec[]) : [];
  const serverIds = new Set(serverRoster.map(r => r.id));
  merged.roster = [
    ...serverRoster.map(sr => {
      if (!ownIds.has(sr.id as string)) return sr;
      const cr = clientRoster.find(r => r.id === sr.id);
      if (!cr) return sr;
      return {
        ...sr,
        phone: cr.phone ?? sr.phone,
        email: cr.email ?? sr.email,
        userId: cr.userId ?? sr.userId,
        linkedUserIds: cr.linkedUserIds ?? sr.linkedUserIds,
      };
    }),
    ...clientRoster.filter(r => !serverIds.has(r.id) && r.userId === accountId),
  ];

  // customRoleTags / removedIdentities are manager domain — server's stand.
  return merged;
}

// PUT — save the shared dashboard state. Managers overwrite; crew saves are
// merged server-side so a crew session can only touch its own slices.
export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let data: unknown;
  try {
    data = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (data === null || typeof data !== "object") {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  }

  let toSave = data as Rec;

  if (session.user.role !== "MANAGER") {
    const ws = await prisma.workspace.findUnique({ where: { id: WORKSPACE_ID } });
    const server: Rec = (ws?.data as Rec) ?? {};
    const emailLc = (session.user.email ?? "").toLowerCase();
    const ownIds = new Set<string>();
    for (const r of (Array.isArray(server.roster) ? (server.roster as Rec[]) : [])) {
      const linked = Array.isArray(r.linkedUserIds) && (r.linkedUserIds as string[]).includes(session.user.id);
      const emailMatch = emailLc && typeof r.email === "string" && r.email.toLowerCase() === emailLc;
      if (r.userId === session.user.id || r.id === session.user.id || linked || emailMatch) {
        ownIds.add(r.id as string);
      }
    }
    ownIds.add(session.user.id);
    toSave = mergeCrewWrite(server, data as Rec, ownIds, session.user.id);
  }

  const ws = await prisma.workspace.upsert({
    where: { id: WORKSPACE_ID },
    create: { id: WORKSPACE_ID, data: toSave as object },
    update: { data: toSave as object },
  });

  return NextResponse.json({ ok: true, updatedAt: ws.updatedAt });
}
