# MCBPulse

A modular, multi-tenant School Operating System — an independent functional
re-implementation of the product surface publicly visible on MyClassBoard
(ERP, Finance, Admissions CRM, HR, LMS, Connect, Safety, Mobile, AI). The
full architecture is in
[`docs/architecture-blueprint-raw.md`](docs/architecture-blueprint-raw.md);
read section 20 ("Claude Build Strategy") before adding a new module — each
phase gets its own schema slice and its own pass, not one giant change.

**Two tiers exist today, and it matters which one you're looking at:**

1. **Phase 0 — working software.** Tenancy, identity, RBAC/ABAC, audit
   logging, feature flags. Real routes read and write these tables; you can
   log in and use it.
2. **Phase 1+ — schema only.** The full canonical data model from blueprint
   section 8 (People, Academics, Attendance, Admissions, LMS, Assessment,
   Finance, Accounting, HR, Operations, Communication, Files, AI — 72 tables)
   exists in `prisma/schema.prisma` and migrates cleanly. **No route,
   permission, or business logic touches any of it yet.** Each module gets
   wired up in the phase that builds it. The architecture is laid down; the
   rooms aren't furnished.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind v4
- PostgreSQL via Prisma 7 (no Rust engine — connects through `@prisma/adapter-pg`)
- Auth.js (`next-auth` v5) with a Credentials provider, JWT sessions
- Vitest for unit tests

## Getting started

```bash
npm install
cp .env.example .env   # then fill in DATABASE_URL and AUTH_SECRET
npx prisma migrate deploy
npm run db:seed
npm run dev
```

No Postgres handy? `npx prisma dev` runs a local, disposable Postgres-compatible
server and prints a connection string to put in `.env`. Two caveats about
that engine, both learned the hard way:

- **Never run `migrate dev` against it — it can destroy your data.**
  `migrate dev` needs a shadow database to replay history into, and the
  `prisma dev` engine is a single shared store where database names are
  effectively aliases. So its "shadow" DB *is* your main DB. In this repo's
  history, a `migrate dev` attempt plus a `CREATE/DROP DATABASE` of what was
  meant to be a separate shadow DB together wiped every row from every table
  and dropped the `_prisma_migrations` history table, leaving only the empty
  schema behind — the two can't be cleanly separated after the fact, so
  treat both as forbidden on this engine: **no `migrate dev`, no
  `CREATE DATABASE`, no `DROP DATABASE`.** Use `migrate deploy` (and the
  `migrate diff` recipe below). With a real Postgres (Docker, cloud),
  `migrate dev` works normally; set `SHADOW_DATABASE_URL` to an empty second
  database there.
  If history is ever lost again, baseline with
  `npx prisma migrate resolve --applied <migration_name>` for each
  already-present migration, then `migrate deploy`.
- **To author a new migration without a shadow DB**, diff the live DB
  against the schema and hand-place the result:
  ```bash
  npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma \
    --script -o prisma/migrations/$(date +%Y%m%d%H%M%S)_<name>/migration.sql
  npx prisma migrate deploy
  ```
  Read the generated SQL before deploying it.

The seed script prints two demo logins (`platform-admin@mcbpulse.local` and
`admin@nalanda-demo.local`, both `ChangeMe!123`) — change or delete them
before this touches anything real.

## What's actually implemented

| Area | Where |
| --- | --- |
| Tenant model (Organization → Branch → AcademicYear) | [`prisma/schema.prisma`](prisma/schema.prisma) |
| Identity + RBAC/ABAC (Role, Permission, RoleAssignment) | [`prisma/schema.prisma`](prisma/schema.prisma), [`src/lib/rbac.ts`](src/lib/rbac.ts) |
| `authorize()` — tenant-scope + role-permission check | [`src/lib/rbac.ts`](src/lib/rbac.ts) |
| Audit log (append-only) | [`src/lib/audit.ts`](src/lib/audit.ts) |
| Feature flags (global default + per-org override) | [`src/lib/feature-flags.ts`](src/lib/feature-flags.ts) |
| Auth (Credentials + JWT, login/logout, failed-login audit) | [`src/lib/auth.ts`](src/lib/auth.ts) |
| App shell + nav (placeholders for unbuilt phases) | [`src/components/app-shell.tsx`](src/components/app-shell.tsx) |
| A real page gated by a permission check | [`src/app/(app)/settings/users/page.tsx`](src/app/(app)/settings/users/page.tsx) |
| **Schema only:** canonical data model for all 13 Phase 1+ domains (72 tables, 29 enums) | [`prisma/schema.prisma`](prisma/schema.prisma) from the `PHASE 1+ CANONICAL DATA MODEL` banner down |

## Known limitations / follow-ups

- **Partial unique index isn't in `schema.prisma`.** Postgres treats every
  `NULL` as distinct, so the `@@unique([organizationId, key])` on `Role`
  doesn't stop two system roles from sharing a key. The actual guarantee is
  a hand-added partial index in
  `prisma/migrations/20260914074840_phase0_foundation/migration.sql`. The
  next time `prisma migrate dev` generates a migration, check its diff for
  a stray `DROP INDEX "Role_system_key_key"` and remove that line. (The
  `migrate diff --from-config-datasource` path used for the second migration
  did *not* emit that DROP — live-DB introspection skips indexes it can't
  represent — but `migrate dev`'s shadow-replay path may still differ, so
  the check stands.)
- **Phase 1+ tables have no RBAC permissions yet.** `src/lib/permissions.ts`
  only lists foundation modules. Adding a module's permissions belongs with
  the code that first checks them — an inert permission row nothing gates is
  just noise in the catalog.
- **Some cross-table invariants are application-level, not schema-level.**
  Called out inline in `schema.prisma`: `LeaveRequest` must have exactly one
  of `studentId`/`staffId`; a `JournalEntry`'s lines must balance; a
  `FileAsset`'s `classification` is a free string pending a real
  classification policy. Prisma's schema language can't express any of
  these; the service layer for each module must.
- **Single-tenant assumption in the UI.** `getViewerContext()` (`src/lib/tenant.ts`)
  picks the first role assignment as "the" organization. Correct for anyone
  who belongs to one school; a Platform Admin auditing several tenants needs
  a real org switcher, which is a Phase 1+ concern once there's more than one
  screen to switch between.
- **No OIDC/SSO yet.** Auth is Credentials + JWT only. The `RefreshToken`
  table exists for a future mobile/API client but nothing issues or rotates
  tokens through it yet — today's web session is the NextAuth JWT cookie.
- **`prisma dev`'s local Postgres is throwaway.** It's for local development
  only; point `DATABASE_URL` at a real Postgres instance for anything that
  needs to persist or be shared, including CI (see `.github/workflows/ci.yml`,
  which runs against a real `postgres:16` service container).
- **Known dev-dependency CVEs, accepted.** `npm audit` reports issues in
  `mysql2` (pulled in transitively by `@prisma/config` even though this
  project only uses Postgres) and in `deepmerge-ts`/`vitest`'s config-merge
  path. None of these run in this app's production code path. Revisit when
  Prisma 8 stabilizes (currently RC) rather than downgrading Prisma to
  silence them.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` / `npm run start` | Production build / run |
| `npm run lint` / `npm run typecheck` | ESLint / `tsc --noEmit` |
| `npm run test` | Vitest (unit tests, no DB required) |
| `npm run db:migrate` | `prisma migrate dev` |
| `npm run db:seed` | Seed permissions, system roles, a demo org, and two demo users |
| `npm run db:studio` | Prisma Studio |
