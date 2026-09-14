# MCBPulse

A modular, multi-tenant School Operating System — an independent functional
re-implementation of the product surface publicly visible on MyClassBoard
(ERP, Finance, Admissions CRM, HR, LMS, Connect, Safety, Mobile, AI). The
full architecture is in
[`docs/architecture-blueprint-raw.md`](docs/architecture-blueprint-raw.md);
read section 20 ("Claude Build Strategy") before adding a new module — each
phase gets its own schema slice and its own pass, not one giant change.

**Three tiers exist today, and it matters which one you're looking at:**

1. **Phase 0 — working.** Tenancy, identity, RBAC/ABAC, audit logging,
   feature flags. Real routes read and write these tables; you can log in
   and use it.
2. **Phase 1 (SIS) — working.** Students (searchable list, create/edit, a
   Student 360 profile), guardians with sibling linking, emergency contacts,
   the enrollment lifecycle state machine (enroll → promote → transfer /
   withdraw / graduate), bulk CSV import with a validation preview and
   atomic commit, CSV export, staff creation with a scoped role grant, and
   grades/sections per academic year. Gated by the `phase1.sis` feature flag
   and by 16 new RBAC permissions (`sis.*`, `academics.structure`).
   Code lives in `src/modules/sis/` (services, pure logic, tests) and
   `src/app/(app)/students|staff|settings/`.
3. **Phase 2 (Academics) — working.** Subjects & curricula, teaching
   assignments (which teacher takes which subject in which section), a
   per-section timetable with teacher/section/room **conflict detection**,
   a daily attendance register with **optimistic locking** on every record,
   **lock-after-submission** with approve-permission corrections, student
   leave that pre-fills the register as Excused, 30-day summaries, and a
   teacher's daily view on the dashboard. Gated by `phase2.academics` and 10
   new permissions (`academics.*`). This phase also delivers the blueprint's
   **attribute policy**: `authorize()` now reports when a grant comes only
   from section-scoped roles (Teacher, Class Teacher), and every SIS and
   Academics screen restricts such a viewer to the sections they hold a
   teaching assignment in. Code in `src/modules/academics/` and
   `src/app/(app)/academics/`.
4. **Phase 3 (Admissions CRM) — working.** Lead sources & campaigns; leads
   with a pipeline state machine (NEW → CONTACTED → QUALIFIED → APPLIED →
   ADMITTED, LOST/reopen — APPLIED and ADMITTED are set by the system, never
   picked), phone-normalized **de-duplication**, counselor assignment,
   follow-up dates and notes on an audit timeline, a funnel view; applications
   with their own status machine (documents pending → review → offered /
   waitlisted → accepted / rejected, decisions gated by `approve`), a document
   checklist and appointments; **conversion of an accepted application into
   an SIS student + guardian** in one transaction; a **public enquiry form**
   per branch (`/apply/<org-slug>/<branch-code>`) with a honeypot, per-IP
   rate limiting, and duplicate absorption that never reveals whether a phone
   number is known. Gated by `phase3.admissions` and 11 `admissions.*`
   permissions. Code in `src/modules/admissions/` and
   `src/app/(app)/admissions/`, `src/app/apply/`.
5. **Phase 4+ — schema only.** The rest of the canonical data model from
   blueprint section 8 (Finance, Accounting, LMS, Assessment, HR, Operations,
   Communication, Files, AI) exists in `prisma/schema.prisma` and migrates
   cleanly. **No route or business logic touches any of it yet.** (Finance
   permissions are already in the catalog and granted to roles ahead of
   Phase 4; they gate nothing until it lands.)

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
- **It sheds connections under concurrency.** A page rendering several
  queries in parallel plus one extra script was enough to get
  `Connection terminated unexpectedly` / `ECONNRESET`. The app's pool is
  capped at 5 with keep-alive (`src/lib/db.ts`) to leave the engine headroom;
  if you need to run a script against the DB while the dev server is up and
  it gets reset, stop the dev server first. A real Postgres has none of this.

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
| SIS access gate: branch → feature flag → `authorize()`, for pages and for server actions (which must name the exact branch they were rendered for) | [`src/modules/sis/access.ts`](src/modules/sis/access.ts), [`src/lib/branch-context.ts`](src/lib/branch-context.ts) |
| Student lifecycle state machine (pure, tested) | [`src/modules/sis/lifecycle.ts`](src/modules/sis/lifecycle.ts) |
| CSV import: RFC 4180 parser, header-alias mapping, row-level validation with duplicate detection (pure, tested); preview + atomic commit that re-validates against fresh DB state | [`src/modules/sis/csv.ts`](src/modules/sis/csv.ts), [`import-validation.ts`](src/modules/sis/import-validation.ts), [`import.service.ts`](src/modules/sis/import.service.ts) |
| Students / guardians / staff / academic-structure services (tenant-pinned, every mutation audited) | [`src/modules/sis/*.service.ts`](src/modules/sis/) |
| Student 360 profile with lifecycle actions, sibling-aware guardian linking, and an audit timeline | [`src/app/(app)/students/[id]/page.tsx`](src/app/(app)/students/[id]/page.tsx) |
| Attribute policy: `resolveAccess()` reports section-scoped grants; `getSectionScope()` turns that into the viewer's assigned sections; SIS/Academics pages filter by it | [`src/lib/rbac.ts`](src/lib/rbac.ts), [`src/modules/academics/scope.ts`](src/modules/academics/scope.ts) |
| Timetable conflict detection (pure, tested): section / teacher / room overlaps, minute-precise, edit-safe | [`src/modules/academics/timetable-conflicts.ts`](src/modules/academics/timetable-conflicts.ts) |
| Attendance register: leave-aware defaults, first save creates the session, later saves check each record's `version`, locked sessions need `approve`; summaries where Late counts as attended and Excused leaves the denominator | [`src/modules/academics/attendance.service.ts`](src/modules/academics/attendance.service.ts), [`attendance-summary.ts`](src/modules/academics/attendance-summary.ts) |
| Teacher daily view: today's slots and sections still awaiting a register | [`src/app/(app)/dashboard/page.tsx`](src/app/(app)/dashboard/page.tsx) |
| Admissions pipeline: lead and application state machines (pure, tested); system-only APPLIED/ADMITTED | [`src/modules/admissions/pipeline.ts`](src/modules/admissions/pipeline.ts) |
| One definition of "same phone number" for lead de-dup, guardian reuse and the guardian picker — full-number match, never a suffix | [`src/lib/phone.ts`](src/lib/phone.ts) |
| Admissions → SIS hand-off: accepted application → Student + Guardian + lead ADMITTED, one transaction, cross-module audit | [`src/modules/admissions/applications.service.ts`](src/modules/admissions/applications.service.ts) |
| Public enquiry intake: honeypot, in-process per-IP rate limit, silent duplicate absorption | [`src/modules/admissions/public-intake.ts`](src/modules/admissions/public-intake.ts), [`src/app/apply/`](src/app/apply/) |
| Generic server-action form (fields as children, one client component for many small forms) | [`src/components/action-form.tsx`](src/components/action-form.tsx) |
| **Schema only:** canonical data model for the Phase 4+ domains (part of 72 tables / 29 enums) | [`prisma/schema.prisma`](prisma/schema.prisma) from the `PHASE 1+ CANONICAL DATA MODEL` banner down |

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
- **Phase 5+ tables have no RBAC permissions yet.** `src/lib/permissions.ts`
  lists foundation, SIS, Academics, Admissions and Finance modules. Adding a
  module's permissions belongs with the code that first checks them.
- **The public enquiry form has no OTP and no CAPTCHA.** Blueprint 10.5 wants
  mobile/email OTP validation; that needs an SMS/email provider (Phase 6
  Connect). Today it has a honeypot, a per-IP rate limit (in-process — move
  it to Redis before running more than one server), and silent duplicate
  absorption. WhatsApp/campaign messaging and the chatbot are Phase 6 too.
- **Admission doesn't collect a fee.** Blueprint 10.2 puts "fee payment"
  between offer and enrollment; conversion currently creates the student
  directly. Phase 4 Finance adds the invoice, and the hook is the
  `Application.convertedStudentId` link.
- **Follow-ups are manual dates, not automated sequences.** "Automated
  follow-up schedule creates tasks/reminders" and lead scoring (blueprint
  11.12) belong to the shared workflow engine (section 12).
- **A teacher with no teaching assignments sees no students.** That is the
  attribute policy working as specified, but it means "create the staff
  record" and "assign them a subject in a section" are both required before
  a new teacher can do anything — the Staff screen doesn't yet say so.
  Anyone who also holds a broad role (Principal, Admin) is unscoped.
- **Attendance is daily, not per period.** Period-wise/subject-wise
  registers (blueprint 11.3) need a `timetableSlotId` on the session and a
  different uniqueness rule; the daily register was the right first cut.
  Substitutions / temporary timetable overrides (11.4) and parent
  notifications on absence (11.3, Phase 6 Connect) are also deferred.
- **Attendance lock is manual.** The blueprint's "lock after a configured
  time" wants a scheduled job; today someone with `approve` locks the
  register by hand. The data model already carries who locked it and when.
- **No custom fields or student documents yet.** Custom fields need the
  shared Dynamic Forms engine (blueprint 11.9); documents need the Files
  storage adapter (Phase 8/Files). The `Student.photoFileId` and
  `FileAsset` tables exist but nothing writes them.
- **Staff logins can't be invited by email.** Connect (Phase 6) owns email.
  Interim: the staff form lets an admin set an initial password; leaving it
  blank creates the login in INVITED state with no way to sign in yet.
- **Promotion is a section move, not a year-end batch.** Moving a whole
  class to next year's sections in one action (blueprint 10.2 "at year end:
  promote, retain, transfer or graduate") is a follow-up; today each student
  is promoted from their profile, and the prior section survives only in the
  audit timeline — a `StudentSectionHistory` table is the right fix when
  report cards need it.
- **Sessions are validated against the database on every request.**
  `getViewerContext()` refuses a JWT whose user no longer exists or isn't
  ACTIVE. Found when a re-seeded dev database left a browser holding a valid
  token for a vanished user id — the same shape as a disabled employee
  keeping access.
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
