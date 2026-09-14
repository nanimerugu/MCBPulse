# MCBPulse

A modular, multi-tenant School Operating System — an independent functional
re-implementation of the product surface publicly visible on MyClassBoard
(ERP, Finance, Admissions CRM, HR, LMS, Connect, Safety, Mobile, AI). The
full architecture is in
[`docs/architecture-blueprint-raw.md`](docs/architecture-blueprint-raw.md);
read section 20 ("Claude Build Strategy") before adding a new module — each
phase gets its own schema slice and its own pass, not one giant change.

**This repository currently contains Phase 0 only:** tenancy, identity,
RBAC/ABAC, audit logging, and feature flags. Nothing else (SIS, academics,
finance, admissions, LMS, HR, operations, communication, AI) exists yet.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind v4
- PostgreSQL via Prisma 7 (no Rust engine — connects through `@prisma/adapter-pg`)
- Auth.js (`next-auth` v5) with a Credentials provider, JWT sessions
- Vitest for unit tests

## Getting started

```bash
npm install
cp .env.example .env   # then fill in DATABASE_URL and AUTH_SECRET
npx prisma migrate dev
npm run db:seed
npm run dev
```

No Postgres handy? `npx prisma dev` runs a local, disposable Postgres-compatible
server and prints a connection string to put in `.env`.

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

## Known limitations / follow-ups

- **Partial unique index isn't in `schema.prisma`.** Postgres treats every
  `NULL` as distinct, so the `@@unique([organizationId, key])` on `Role`
  doesn't stop two system roles from sharing a key. The actual guarantee is
  a hand-added partial index in
  `prisma/migrations/20260914074840_phase0_foundation/migration.sql`. The
  next time `prisma migrate dev` generates a migration, check its diff for
  a stray `DROP INDEX "Role_system_key_key"` and remove that line.
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
