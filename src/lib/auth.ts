import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { createHash } from "crypto";
import { prisma } from "./prisma";

export function hashPin(pin: string): string {
  return createHash("sha256")
    .update(pin + (process.env.NEXTAUTH_SECRET ?? ""))
    .digest("hex");
}

// Sliding-window PIN rate limit: MAX failed windows per IP per WINDOW_MS.
// DB-backed so it holds across serverless cold starts.
const PIN_WINDOW_MS = 15 * 60 * 1000;
const PIN_MAX_ATTEMPTS = 10;

async function pinAttemptsExceeded(ip: string): Promise<boolean> {
  const key = `pin:${ip}`;
  try {
    const rec = await prisma.authAttempt.findUnique({ where: { key } });
    const nowMs = Date.now();
    if (!rec || nowMs - rec.windowStart.getTime() > PIN_WINDOW_MS) {
      await prisma.authAttempt.upsert({
        where: { key },
        create: { key, count: 1 },
        update: { count: 1, windowStart: new Date() },
      });
      return false;
    }
    if (rec.count >= PIN_MAX_ATTEMPTS) return true;
    await prisma.authAttempt.update({ where: { key }, data: { count: { increment: 1 } } });
    return false;
  } catch {
    // Rate limiting must never take down sign-in (e.g. table not migrated yet).
    return false;
  }
}

async function clearPinAttempts(ip: string): Promise<void> {
  try { await prisma.authAttempt.deleteMany({ where: { key: `pin:${ip}` } }); } catch {}
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    // Google — only active when credentials are set in env.
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            // Links Google account to existing email/password account — one account per person.
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),

    // Email + password sign-in.
    CredentialsProvider({
      id: "credentials",
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const user = await prisma.user.findUnique({ where: { email: credentials.email } });
        if (!user || !user.passwordHash) return null;
        const valid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!valid) return null;
        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),

    // PIN sign-in — crew members sign in with their 4–6 digit PIN.
    // Rate-limited per client IP: short PINs are brute-forceable without it.
    CredentialsProvider({
      id: "pin",
      name: "pin",
      credentials: { pin: { label: "PIN", type: "password" } },
      async authorize(credentials, req) {
        if (!credentials?.pin || !/^\d{4,6}$/.test(credentials.pin)) return null;
        const ip = ((req?.headers?.["x-forwarded-for"] as string) || "unknown").split(",")[0].trim();
        if (await pinAttemptsExceeded(ip)) return null;
        const user = await prisma.user.findFirst({ where: { pin: hashPin(credentials.pin) } });
        if (!user) return null;
        await clearPinAttempts(ip);
        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as any).role;
      }
      // OAuth users don't pass role through the user object — resolve from DB.
      if (!token.role && token.email) {
        const dbUser = await prisma.user.findUnique({ where: { email: token.email } });
        if (dbUser) {
          token.id = dbUser.id;
          token.role = dbUser.role;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        (session.user as any).role = token.role;
      }
      return session;
    },
  },
};
