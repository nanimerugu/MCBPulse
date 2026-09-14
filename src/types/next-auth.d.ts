import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
    /** Seconds since epoch when this session was signed in. */
    authTime?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    authTime?: number;
  }
}
