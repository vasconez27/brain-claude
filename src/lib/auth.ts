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
    CredentialsProvider({
      id: "pin",
      name: "pin",
      credentials: { pin: { label: "PIN", type: "password" } },
      async authorize(credentials) {
        if (!credentials?.pin || !/^\d{4,6}$/.test(credentials.pin)) return null;
        const user = await prisma.user.findFirst({ where: { pin: hashPin(credentials.pin) } });
        if (!user) return null;
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
