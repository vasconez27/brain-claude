import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendMassSMS } from "@/lib/sms";

const schema = z.object({
  subject: z.string().optional(),
  body: z.string().min(1).max(1600),
  recipientIds: z.array(z.string()).min(1),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "MANAGER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { subject, body: msgBody, recipientIds } = parsed.data;

  const recipients = await prisma.user.findMany({
    where: { id: { in: recipientIds } },
    select: { id: true, phone: true },
  });

  const phones = recipients.filter((r) => r.phone).map((r) => r.phone!);
  let twilioResults: { phone: string; sid?: string; error?: string }[] = [];

  if (phones.length > 0 && process.env.TWILIO_ACCOUNT_SID) {
    twilioResults = await sendMassSMS(phones, msgBody);
  }

  const message = await prisma.message.create({
    data: {
      senderId: session.user.id,
      subject,
      body: msgBody,
      recipients: recipientIds,
      twilioSid: twilioResults[0]?.sid ?? null,
    },
  });

  return NextResponse.json({ message, smsResults: twilioResults }, { status: 201 });
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "MANAGER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const messages = await prisma.message.findMany({
    where: { senderId: session.user.id },
    orderBy: { sentAt: "desc" },
  });

  return NextResponse.json(messages);
}
