import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendMassSMS } from "@/lib/sms";

const schema = z
  .object({
    subject: z.string().optional(),
    body: z.string().min(1).max(1600),
    // User-table ids (phones looked up) and/or raw phone numbers (the
    // dashboard roster keeps phones directly; most crew have no User row).
    recipientIds: z.array(z.string()).optional(),
    phones: z.array(z.string()).optional(),
  })
  .refine((d) => (d.recipientIds?.length ?? 0) + (d.phones?.length ?? 0) > 0, {
    message: "recipientIds or phones required",
  });

// Best-effort US normalization: "5551234567" → "+15551234567".
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.startsWith("+") && digits.length >= 8) return `+${digits}`;
  return null;
}

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

  const { subject, body: msgBody, recipientIds = [], phones: directPhones = [] } = parsed.data;

  const recipients = recipientIds.length
    ? await prisma.user.findMany({
        where: { id: { in: recipientIds } },
        select: { id: true, phone: true },
      })
    : [];

  const phones = [
    ...new Set(
      [...recipients.map((r: { id: string; phone: string | null }) => r.phone ?? ""), ...directPhones]
        .map(normalizePhone)
        .filter((p): p is string => Boolean(p))
    ),
  ];
  let twilioResults: { phone: string; sid?: string; error?: string }[] = [];

  if (phones.length > 0 && process.env.TWILIO_ACCOUNT_SID) {
    twilioResults = await sendMassSMS(phones, msgBody);
  }

  const message = await prisma.message.create({
    data: {
      senderId: session.user.id,
      subject,
      body: msgBody,
      recipients: recipientIds.length ? recipientIds : phones,
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
