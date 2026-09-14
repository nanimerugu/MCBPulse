import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Prisma 7 has no bundled Rust query engine — the app talks to Postgres
 * through the `pg` driver adapter directly. This is the one PrismaClient
 * instance for the whole app; Next.js dev-mode hot reload would otherwise
 * create a fresh client (and a fresh connection pool) on every edit, so we
 * cache it on `globalThis` in development.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  }
  // Pool settings are passed straight through to `pg.Pool`. Keep-alive and a
  // bounded idle lifetime mean a connection the server has quietly dropped
  // is noticed and replaced instead of being handed to the next request —
  // which surfaced as "Connection terminated unexpectedly" on the first
  // pages after a dev-server restart.
  // `max` is deliberately modest: the local `prisma dev` engine sheds
  // connections under concurrency, and a page's parallel queries queue fine
  // behind a small pool. Raise it for a real Postgres if profiling says so.
  const adapter = new PrismaPg({
    connectionString,
    max: 5,
    keepAlive: true,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
