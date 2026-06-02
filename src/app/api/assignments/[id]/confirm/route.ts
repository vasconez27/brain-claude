import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  status: z.enum(["CONFIRMED", "DECLINED"]),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const assignment = await prisma.shiftAssignment.findUnique({ where: { id } });
  if (!assignment) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (assignment.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const updated = await prisma.shiftAssignment.update({
    where: { id },
    data: {
      status: parsed.data.status,
      confirmedAt: parsed.data.status === "CONFIRMED" ? new Date() : null,
    },
  });

  return NextResponse.json(updated);
}
