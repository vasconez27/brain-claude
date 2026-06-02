import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  location: z.string().optional(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  payRate: z.number().positive(),
  assignTo: z.array(z.string()).optional(),
});

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const where: any = {};
  if (from) where.startTime = { gte: new Date(from) };
  if (to) where.endTime = { ...(where.endTime ?? {}), lte: new Date(to) };

  if (session.user.role === "CREW") {
    const shifts = await prisma.shift.findMany({
      where: {
        assignments: { some: { userId: session.user.id } },
        ...where,
      },
      include: { assignments: { where: { userId: session.user.id } } },
      orderBy: { startTime: "asc" },
    });
    return NextResponse.json(shifts);
  }

  const shifts = await prisma.shift.findMany({
    where,
    include: { assignments: { include: { user: { select: { id: true, name: true, phone: true } } } } },
    orderBy: { startTime: "asc" },
  });
  return NextResponse.json(shifts);
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "MANAGER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { assignTo, ...data } = parsed.data;

  const shift = await prisma.shift.create({
    data: {
      ...data,
      startTime: new Date(data.startTime),
      endTime: new Date(data.endTime),
      managerId: session.user.id,
      assignments: assignTo?.length
        ? { create: assignTo.map((userId) => ({ userId })) }
        : undefined,
    },
    include: { assignments: true },
  });

  return NextResponse.json(shift, { status: 201 });
}
