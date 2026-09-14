// Prisma 7 config: this is what `prisma migrate`, `prisma studio`, and
// `prisma db push` use to reach the database. The app's own PrismaClient
// (src/lib/db.ts) connects separately through the @prisma/adapter-pg driver
// adapter — Prisma 7 no longer reads a connection string out of
// schema.prisma's datasource block for either path.
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
    // A dedicated, always-empty database that `prisma migrate dev` replays
    // the migration history into to compute diffs. Explicit rather than
    // auto-managed because the auto-created one on `prisma dev`'s local
    // server was left dirty between runs and broke migration generation.
    // Read via process.env, not env(), so it's simply absent (not an error)
    // in CI/production where only `migrate deploy` runs and no shadow DB exists.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
