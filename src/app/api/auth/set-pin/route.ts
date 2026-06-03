import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, hashPin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { pin } = await req.json();
  if (!/^\d{4,6}$/.test(pin)) {
    return NextResponse.json({ error: "PIN must be 4–6 digits" }, { status: 400 });
  }

  const hash = hashPin(pin);

  // Enforce one PIN per person — make sure no other user already has this PIN.
  const conflict = await prisma.user.findFirst({
    where: { pin: hash, NOT: { id: session.user.id } },
  });
  if (conflict) {
    return NextResponse.json({ error: "That PIN is already taken — choose a different one" }, { status: 409 });
  }

  await prisma.user.update({ where: { id: session.user.id }, data: { pin: hash } });
  return NextResponse.json({ ok: true });
}
