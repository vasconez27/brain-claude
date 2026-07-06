import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, hashPin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Manager-only: set/reset a crew member's login PIN. PINs are stored hashed,
// so a manager can never VIEW a PIN — only overwrite it to a new value the
// crew member is then told. Fixes the old fake roster "0000" pin that never
// matched the crew member's real login PIN.
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "MANAGER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { userId, email, pin } = await req.json();
  if (!/^\d{4,6}$/.test(pin ?? "")) {
    return NextResponse.json({ error: "PIN must be 4–6 digits" }, { status: 400 });
  }

  // Locate the target crew account by account id or email.
  const target = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : email
      ? await prisma.user.findUnique({ where: { email } })
      : null;
  if (!target) {
    return NextResponse.json({ error: "No account found for that crew member yet" }, { status: 404 });
  }

  const hash = hashPin(pin);
  const conflict = await prisma.user.findFirst({ where: { pin: hash, NOT: { id: target.id } } });
  if (conflict) {
    return NextResponse.json({ error: "That PIN is already in use — pick a different one" }, { status: 409 });
  }

  await prisma.user.update({ where: { id: target.id }, data: { pin: hash } });
  return NextResponse.json({ ok: true });
}
