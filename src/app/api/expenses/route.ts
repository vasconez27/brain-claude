import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  description: z.string().min(1),
  amount: z.number().positive(),
  category: z.string().min(1),
  date: z.string().datetime(),
  receipt: z.string().url().optional(),
});

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const expenses = await prisma.expense.findMany({
    where: { userId: session.user.id },
    orderBy: { date: "desc" },
  });

  return NextResponse.json(expenses);
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const expense = await prisma.expense.create({
    data: { ...parsed.data, date: new Date(parsed.data.date), userId: session.user.id },
  });

  return NextResponse.json(expense, { status: 201 });
}
