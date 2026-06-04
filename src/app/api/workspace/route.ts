import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// One shared workspace document for the whole company.
const WORKSPACE_ID = "main";

// GET — return the saved dashboard state (or null if nothing saved yet).
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ws = await prisma.workspace.findUnique({ where: { id: WORKSPACE_ID } });
  return NextResponse.json({ data: ws?.data ?? null, updatedAt: ws?.updatedAt ?? null });
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
