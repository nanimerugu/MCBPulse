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
  },
});
