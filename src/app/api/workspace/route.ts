import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// One shared workspace document for the whole company.
const WORKSPACE_ID = "main";

// GET — return the saved dashboard state, with every registered CREW account
// merged into the roster so new sign-ups show up automatically (in the admin
// roster and the shift crew picker) without the manager adding them by hand.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ws = await prisma.workspace.findUnique({ where: { id: WORKSPACE_ID } });
  const data: Record<string, unknown> = (ws?.data as Record<string, unknown>) ?? {};

  const crewUsers = await prisma.user.findMany({
    where: { role: "CREW" },
    select: { id: true, name: true, email: true, phone: true },
    orderBy: { name: "asc" },
  });

  // Merge: add any crew account missing from the roster; refresh identity fields
  // on existing ones while preserving manager-set fields (position, tags, notes,
  // active/archived state).
  const roster: Record<string, unknown>[] = Array.isArray(data.roster)
    ? [...(data.roster as Record<string, unknown>[])]
    : [];

  // Accounts the manager explicitly removed from the roster — don't re-add them.
  const removed = new Set(Array.isArray(data.removedUserIds) ? (data.removedUserIds as string[]) : []);

  for (const u of crewUsers) {
    if (removed.has(u.id)) continue;
    const emailLc = (u.email ?? "").toLowerCase();
    const idx = roster.findIndex(r =>
      r.userId === u.id ||
      r.id === u.id ||
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
        userId: u.id,
        name: u.name,
        email: u.email ?? r.email ?? "",
        phone: (r.phone as string) || u.phone || "",
      };
    }
  }

  return NextResponse.json({ data: { ...data, roster }, updatedAt: ws?.updatedAt ?? null });
}

// PUT — overwrite the shared dashboard state. Any signed-in user can save
// (crew confirm/clock in, managers edit shifts) — last write wins.
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

  const ws = await prisma.workspace.upsert({
    where: { id: WORKSPACE_ID },
    create: { id: WORKSPACE_ID, data: data as object },
    update: { data: data as object },
  });

  return NextResponse.json({ ok: true, updatedAt: ws.updatedAt });
}
