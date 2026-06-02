import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "MANAGER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const crew = await prisma.user.findMany({
    where: { role: "CREW" },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      createdAt: true,
      shiftAssignments: {
        select: {
          status: true,
          hoursWorked: true,
          shift: { select: { startTime: true, endTime: true, payRate: true } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(crew);
}
