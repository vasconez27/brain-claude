import twilio from "twilio";

// Constructed lazily: building the client at module load crashes the whole
// route on import when Twilio env vars aren't configured yet.
let _client: ReturnType<typeof twilio> | null = null;
function getClient() {
  if (!_client) {
    _client = twilio(
      process.env.TWILIO_ACCOUNT_SID!,
      process.env.TWILIO_AUTH_TOKEN!
    );
  }
  return _client;
}

export async function sendSMS(to: string, body: string): Promise<string> {
  const msg = await getClient().messages.create({
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
