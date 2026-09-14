import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = typeof credentials?.email === "string" ? credentials.email.trim().toLowerCase() : undefined;
        const password = typeof credentials?.password === "string" ? credentials.password : undefined;
        if (!email || !password) return null;

        const user = await db.user.findUnique({ where: { email } });
        if (!user || !user.passwordHash || user.status !== "ACTIVE") {
          await recordAuditEvent({
            action: "user.login_failed",
            resourceType: "user",
            resourceId: user?.id ?? null,
            after: { email, reason: !user ? "no_such_user" : user.status !== "ACTIVE" ? "inactive" : "no_password_set" },
          });
          return null;
        }

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
          await recordAuditEvent({
            actorUserId: user.id,
            action: "user.login_failed",
            resourceType: "user",
            resourceId: user.id,
            after: { reason: "bad_password" },
          });
          return null;
        }

        await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        await recordAuditEvent({
          actorUserId: user.id,
          action: "user.login_succeeded",
          resourceType: "user",
          resourceId: user.id,
        });

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) {
        token.userId = user.id;
        // When THIS sign-in happened. Compared against User.passwordChangedAt
        // on every request, so resetting a password ends every session that
        // was opened with the old one.
        token.authTime = Math.floor(Date.now() / 1000);
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && typeof token.userId === "string") {
        session.user.id = token.userId;
      }
      if (typeof token.authTime === "number") session.authTime = token.authTime;
      return session;
    },
  },
});
