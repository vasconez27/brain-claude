import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional(),
  password: z.string().min(8),
  role: z.enum(["MANAGER", "CREW"]).default("CREW"),
  inviteCode: z.string().optional(),
});

const MANAGER_INVITE_CODE = process.env.MANAGER_INVITE_CODE ?? "manager2024";

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { name, email, phone, password, role, inviteCode } = parsed.data;

  if (role === "MANAGER" && inviteCode !== MANAGER_INVITE_CODE) {
    return NextResponse.json({ error: "Invalid manager invite code" }, { status: 403 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Email already registered" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { name, email, phone, passwordHash, role },
    select: { id: true, name: true, email: true, role: true },
  });

  return NextResponse.json(user, { status: 201 });
}
