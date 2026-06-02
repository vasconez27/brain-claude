import twilio from "twilio";

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
);

export async function sendSMS(to: string, body: string): Promise<string> {
  const msg = await client.messages.create({
    body,
    from: process.env.TWILIO_PHONE_NUMBER!,
    to,
  });
  return msg.sid;
}

export async function sendMassSMS(
  phones: string[],
  body: string
): Promise<{ phone: string; sid?: string; error?: string }[]> {
  return Promise.all(
    phones.map(async (phone) => {
      try {
        const sid = await sendSMS(phone, body);
        return { phone, sid };
      } catch (err: any) {
        return { phone, error: err.message };
      }
    })
  );
}
