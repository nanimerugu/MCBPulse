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
5. **Phase 4 (Finance) — working.** Fee heads and per-grade fee structures
   (locked once invoices exist, so history can't be rewritten); concessions;
   invoices raised per student or per section (idempotent, concessions
   applied at raise time, lines copied not referenced); payments with
   automatic receipts, partial payments, and an **optimistic lock** on the
   invoice; refunds (requested → approved → processed); and a **double-entry
   ledger** — every payment and processed refund posts a balanced journal
   entry, with a trial balance that says so. Money is handled in integer
   minor units end to end (`src/modules/finance/money.ts`), never floats.
   Gated by `phase4.finance` and 12 `finance.*` permissions. Code in
   `src/modules/finance/` and `src/app/(app)/finance/`.
6. **Phase 5 (LMS) — working, in part.** The teaching loop end to end:
   courses with modules and lessons (an organization-wide catalog, shared by
   every section that teaches them); assignments targeted at a section, with
   a **draft → published** state; a grading roster covering the whole class
   (not just rows that happen to exist) with derived submission status,
   late detection, mark validation and an **optimistic lock** per
   submission; and a per-section **gradebook** with CSV export whose average
   counts graded work only. Gated by `phase5.lms` and 10 `lms.*` permissions,
   and section-scoped for teachers by the Phase 2 attribute policy. Code in
   `src/modules/lms/` and `src/app/(app)/lms/`.
7. **Phase 6 (Connect) — working, with one caveat below.** The Notification
   Service from §13: a **provider abstraction**, a template engine whose
   variables come from a fixed allow-list, audience segmentation resolved at
   send time, per-recipient rendering, consent/opt-out, quiet hours, and a
   delivery log holding what each person actually received. Absence
   notifications fire automatically when a register is first saved.
   **Caveat: no delivery provider is configured, so messages are recorded,
   not delivered** — see below. Gated by `phase6.connect` and 10
   `connect.*` permissions. Code in `src/modules/connect/` and
   `src/app/(app)/connect/`.
8. **Phase 7 (HR) — working, with one large caveat below.** Departments and
   positions as an organization-wide org chart; staff compensation behind
   its *own* permission (`hr.compensation`), separate from the staff
   directory, so leadership can browse people without seeing salaries;
   staff leave with an overlap guard that names the clashing request;
   monthly **payroll runs** (`DRAFT → PROCESSED → PAID`, one per branch per
   month) whose payslips are rebuilt from current pay while draft and frozen
   afterwards, with CSV export; appraisals; and staff exit, which disables
   the login and takes the person off later runs. Paying a run posts one
   balanced journal entry to the Phase 4 ledger (debit salary expense,
   credit bank). **Caveat: the deduction rule is whatever you type — this is
   not a statutory payroll engine** — see below. Gated by `phase7.hr` and 14
   `hr.*` permissions. Code in `src/modules/hr/` and `src/app/(app)/hr/`.
9. **Phase 8 (Operations) — working, six of the eight sub-modules.** Library
   (catalogue, loans, returns, per-borrower limits), inventory/store (stock
   with a **movement ledger** behind every number), transport (vehicles,
   routes, sequenced stops, student allocation), hostel (blocks, rooms,
   allocation and check-out), the **gate register** (who is on campus right
   now) and the **infirmary** (clinic visits that tell a guardian). Four of
   these share one tested invariant — a finite number of places that must
   never go over or negative — in `src/modules/operations/capacity.ts`, and
   the two that race under concurrency (a last library copy, the last of a
   stock item) are enforced by conditional `UPDATE`s rather than
   read-then-write. Gated by `phase8.operations` and 17 `ops.*` permissions.
   **Canteen and "store" are not built** — see below. Code in
   `src/modules/operations/` and `src/app/(app)/operations/`.
10. **Phase 9 (portal) — working. Responsive web, not native apps.** The
    blueprint calls this phase "Mobile"; this is a Next.js application with
    no React Native, so what ships is the **parent, student and driver
    experiences delivered as a mobile-first web portal** at `/portal`, plus a
    staff shell that finally works on a phone. Nobody should read this as
    shipped app-store apps.
    Its foundation is the **"own records only" attribute policy** that Phases
    5, 7 and 8 each deferred: `SELF_SCOPED_ROLE_KEYS` in
    [`src/lib/rbac.ts`](src/lib/rbac.ts) makes a decision come back
    `selfScoped`, the staff gate **refuses** such a decision outright, and
    [`src/modules/portal/scope.ts`](src/modules/portal/scope.ts) turns the
    viewer's identity into the exact set of student ids they may see —
    before any query runs, so it fails closed. Gated by `phase9.portal`.
11. **Phase 10 (AI) — the gateway is real; no model is connected.** An AI
    Gateway (blueprint §7, §21 rule 14) that every AI request goes through:
    permission → redact → fence → provider → account → audit. Capabilities
    require the SAME permission as the records they touch, so AI can never be
    a way around RBAC. Identifiers are redacted before anything is sent and
    restored afterwards; retrieved school data is fenced as explicitly
    untrusted so it cannot act as instructions; usage and token estimates are
    recorded per request. **No provider is configured, so nothing is
    generated** — the shipped adapter records instead, the same honest shape
    as Connect. The gateway deliberately cannot write: every capability
    returns text for a person to accept or reject. Gated by `ai.copilot` and
    2 `ai.*` permissions. Code in `src/modules/ai/`.
12. **Phase 11 (Analytics) — working.** A cross-module dashboard and a
    **report catalogue** with CSV export. Analytics owns no tables: every
    figure is computed from the module that owns it, using that module's own
    helpers (`paidMinorOf`, `summarize`), so a dashboard can never disagree
    with the fee desk. A report is a fixed DECLARATION — one permission, one
    column set, one hand-written query — not a user-composed filter that
    becomes SQL, so the reporting layer cannot be turned into an
    exfiltration tool. Each report requires the permission of the module it
    reads (the staff directory has no pay column because it requires
    `sis.staff:view`, not `hr.compensation:view`), and that check is
    repeated on the export route rather than inherited from the page. Gated
    by `phase11.analytics` and 3 `analytics.*` permissions. Code in
    `src/modules/analytics/`.
13. **Phase 12 (Hardening) — partly done, and the rest is written down.**
    Security headers with a real CSP (`frame-ancestors none`,
    `form-action self`, HSTS in production, no `X-Powered-By`); **login
    throttling** keyed on IP *and* email so neither an office behind one NAT
    nor a targeted user can be locked out; a `/api/health` liveness and
    readiness endpoint that returns 503 when the database is unreachable and
    deliberately reveals nothing else; skip links and nav landmarks on both
    shells. What is still missing — 2FA, a nonce-based CSP, Redis-backed
    rate limiting, alerting, a load test, a screen-reader pass — is listed
    honestly in [`docs/operations-runbook.md`](docs/operations-runbook.md)
    alongside backup/restore, migration rollback and an incident checklist.
14. **Examcell — working.** The other half of the blueprint's Phase 5:
    question banks with MCQ / true-false / short-answer / essay questions,
    **paper generation** from a blueprint of "n easy MCQs, n hard essays"
    that refuses rather than approximating (a shortfall names exactly which
    line the bank is short on; a paper that misses the exam total is
    rejected), a seeded shuffle so a generated paper is reproducible from
    its inputs, publishing that freezes the paper and creates an attempt row
    per enrolled student, **auto-grading of objective questions only**, and
    teacher marking for the rest. Gated by `exams.examcell` and 7 `exams.*`
    permissions, section-scoped for teachers by the Phase 2 attribute
    policy. Code in `src/modules/examcell/`. Examcell (question banks, papers, online
    exam attempts) and the rest of blueprint section 8 (Files, AI) exist in
    `prisma/schema.prisma` and migrate cleanly. **No route or business logic
    touches any of it yet.**

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
  `Connection terminated unexpectedly` / `ECONNRESET`, and later a
  `08P01: bind message supplies 4 parameters, but prepared statement ""
  requires 0` — the proxy losing prepared-statement state mid-request. Both
  are intermittent and clear on reload; neither has been seen against a real
  Postgres. The app's pool is capped at 5 with keep-alive
  (`src/lib/db.ts`) to leave the engine headroom; stop the dev server before
  running a script against the same database. There is deliberately **no
  blanket query retry** in `db.ts` — retrying a write whose outcome is
  unknown risks double-charging someone, which is a worse failure than a
  500 the user can refresh past.

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
| Money in integer minor units; invoice/status/posting rules (pure, tested) | [`src/modules/finance/money.ts`](src/modules/finance/money.ts) |
| Payments: optimistic lock, auto receipt, status recompute, balanced journal posting — one transaction | [`src/modules/finance/payments.service.ts`](src/modules/finance/payments.service.ts) |
| Double-entry ledger and trial balance | [`src/modules/finance/ledger.service.ts`](src/modules/finance/ledger.service.ts) |
| Grading rules: derived submission status, late detection, mark validation, graded-only averaging (pure, tested) | [`src/modules/lms/grading.ts`](src/modules/lms/grading.ts) |
| Grading roster: whole-class rows, validate-all-before-writing-any, per-submission optimistic lock | [`src/modules/lms/assignments.service.ts`](src/modules/lms/assignments.service.ts) |
| Template engine: fixed variable allow-list, no property traversal, unknown variables rejected at save (pure, tested) | [`src/modules/connect/templates.ts`](src/modules/connect/templates.ts) |
| Delivery policy: consent, de-duplication, midnight-wrapping quiet hours (pure, tested) | [`src/modules/connect/delivery-policy.ts`](src/modules/connect/delivery-policy.ts) |
| Provider abstraction — swap the recording adapter for a real gateway here | [`src/modules/connect/providers.ts`](src/modules/connect/providers.ts) |
| Internal notify API other modules call; never throws into its caller | [`src/modules/connect/notify.ts`](src/modules/connect/notify.ts) |
| Payroll arithmetic and lifecycle: clamped deductions that can't drive net pay negative, `DRAFT→PROCESSED→PAID`, period eligibility from join/exit dates (pure, tested) | [`src/modules/hr/payroll.ts`](src/modules/hr/payroll.ts) |
| Payroll run: regenerate-while-draft, named skip reasons, and a status flip that shares one transaction with its ledger posting | [`src/modules/hr/payroll.service.ts`](src/modules/hr/payroll.service.ts) |
| Staff leave: inclusive day counts, overlap detection that ignores rejected requests (pure, tested) | [`src/modules/hr/leave.ts`](src/modules/hr/leave.ts) |
| Compensation behind its own permission, plus exit that disables the login in the same transaction | [`src/modules/hr/compensation.service.ts`](src/modules/hr/compensation.service.ts) |
| Seed reconciles system-role grants — a permission removed from a role definition is revoked, not left behind | [`prisma/seed.ts`](prisma/seed.ts) |
| Nav feature flags derived from the nav items themselves, so a new module can't ship invisible | [`src/components/app-shell.tsx`](src/components/app-shell.tsx) |
| One capacity invariant shared by hostel rooms, vehicle seats, library copies and stock (pure, tested) | [`src/modules/operations/capacity.ts`](src/modules/operations/capacity.ts) |
| Last-copy and last-item races enforced by conditional `UPDATE`s, not read-then-write | [`library.service.ts`](src/modules/operations/library.service.ts), [`inventory.service.ts`](src/modules/operations/inventory.service.ts) |
| Loan rules: derived overdue, fines computed but never charged, per-borrower limits (pure, tested) | [`src/modules/operations/library.ts`](src/modules/operations/library.ts) |
| Stock movement ledger, so a quantity always has a reason behind it (pure, tested) | [`src/modules/operations/stock.ts`](src/modules/operations/stock.ts) |
| Urgent guardian notice that overrides quiet hours, and says plainly when it reached nobody (pure, tested) | [`delivery-policy.ts`](src/modules/connect/delivery-policy.ts), [`notify.ts`](src/modules/connect/notify.ts) |
| "Own records only" attribute policy: self-scoped roles reported by `resolveAccess` (tested), refused by the staff gate, resolved to an id list by the portal | [`src/lib/rbac.ts`](src/lib/rbac.ts), [`src/modules/portal/scope.ts`](src/modules/portal/scope.ts) |
| Portal reads that reuse Finance's own definition of "paid" rather than a second one | [`src/modules/portal/portal.service.ts`](src/modules/portal/portal.service.ts) |
| Landing route chosen from the roles held, so a parent never lands on a staff shell that refuses them | [`src/modules/portal/landing.ts`](src/modules/portal/landing.ts) |
| Mobile-first portal shell, and a staff sidebar that becomes a drawer below `sm` with no client JS | [`src/app/portal/layout.tsx`](src/app/portal/layout.tsx), [`src/components/app-shell.tsx`](src/components/app-shell.tsx) |
| **Schema only:** canonical data model for the Phase 10+ domains (part of 75 tables / 32 enums) | [`prisma/schema.prisma`](prisma/schema.prisma) from the `PHASE 1+ CANONICAL DATA MODEL` banner down |

## Known limitations / follow-ups

- **Phase 9 is a responsive web portal, not native apps.** There is no React
  Native, no app store build, no push notification and no offline mode. The
  blueprint's "driver experience" here is a read-only manifest — there is no
  GPS, no live tracking and no boarding scan.
- **The portal is read-only.** A parent can see dues but cannot pay (no
  gateway), a student can see work but cannot submit it, and nobody can
  update their own contact details. Every write still goes through the
  school office.
- **Portal logins are created by the seed, not by the product.** There is no
  invite flow, no email verification, no self-service password reset and no
  OTP. `Guardian.userId` and `Student.userId` are set directly; a real
  deployment needs an onboarding path before any of this reaches a family.
- **Canteen is not built, and "store" is the same table as inventory.** The
  blueprint's Phase 8 names eight sub-modules; the schema carries a
  `CanteenItem` with a name and a price and nothing else — no wallet, no
  account, no transaction. A menu with prices and no transactions is a
  brochure, so it was left out rather than shipped as a stub. A real canteen
  needs a prepaid wallet, a till, and a link into Finance.
- **Library fines are calculated and shown, never charged.** `fineMinor()`
  gives the amount at a per-day rate, and nothing turns it into an invoice
  line. Whether a school fines at all, waives for siblings, or blocks a
  report card over 40 rupees is policy, and guessing it would be worse than
  leaving the hook visible.
- **Hostel and transport have no billing, and transport has no attendance.**
  Allocating a bed or a seat records who is where; it does not raise a fee,
  and nothing records who actually boarded the bus this morning. GPS, route
  tracking and a driver app are Phase 9's "driver experience".
- **Payroll is arithmetic, not a statutory engine — do not file with it.**
  A run carries one deduction percentage plus an optional fixed amount, both
  typed in by whoever opens the run and recorded on it. MCBPulse does **not**
  compute PF slabs, ESI eligibility, state-varying professional tax, or TDS
  against an employee's declarations, and produces no statutory return.
  Blueprint §18 requires legal review before real use. The deliberate choice
  (`src/modules/hr/payroll.ts`) is that no numbers beat guessed numbers that
  look official. Paying a run credits **bank** for net pay only; deductions
  are not posted to a statutory liability account, because doing so would
  assert a treatment this system isn't qualified to make.
- **Payroll does not prorate.** Approved staff leave inside a period is shown
  on the run as context (an "N days" column) and changes nothing. Loss-of-pay
  rules, leave balances and leave types are a policy layer that isn't built;
  a school needing them must adjust the pay figure by hand before generating.
- **Staff still can't file their own leave.** Phase 9 built the "own records
  only" mechanism (`SELF_SCOPED_ROLE_KEYS`), but it resolves to a set of
  *student* ids — the shape a parent, student or driver needs. Staff
  self-service needs the same idea pointed at the viewer's own `Staff` row,
  plus a staff-facing surface that is scoped rather than refused, since the
  staff gate currently refuses every self-scoped decision outright. Until
  that exists `hr.leave` stays unscoped and therefore stays with HR and
  school leadership; ordinary staff roles get only `hr.org:view`.
- **Exiting a staff member disables their login but doesn't reassign their
  work.** Subject assignments, timetable slots and authored assignments stay
  pointed at them; nothing prompts a handover.
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
- **Connect records messages; it does not deliver them.** The only shipped
  adapter writes each message to the delivery log marked `recorded` and
  returns success — deliberately labelled so a dev run can never be mistaken
  for messages parents received. Everything upstream (audience, consent,
  quiet hours, rendering, logging, audit) is real. A live gateway means
  implementing `MessageProvider` and returning it from `getProvider`;
  nothing above that file changes.
- **Sending is synchronous and unqueued.** Blueprint §13 wants queue workers
  so a school action never blocks on a provider; today a broadcast loops
  in-request, which is fine for a class and wrong for 4,000 guardians.
  Scheduled broadcasts and quiet-hours deferrals are *recorded* with a send
  time but nothing sweeps them — that sweeper is the same missing worker.
  Retries and dead-lettering likewise.
- **OTP and WhatsApp templates still aren't real.** Phase 3's public form
  wants OTP; both need a live provider plus (for WhatsApp) template
  pre-approval by Meta.
- **Quiet hours are UTC.** `Branch.timezone` exists and isn't consulted yet;
  a school in IST setting 21:00 is currently setting 21:00 UTC.
- **Phase 10+ tables have no RBAC permissions yet.** `src/lib/permissions.ts`
  lists foundation, SIS, Academics, Admissions, Finance, LMS, Connect, HR
  and Operations modules. Adding a module's permissions belongs with the
  code that first checks them.
- **Students don't submit their own work.** Teachers record submissions and
  marks, which matches how offline work actually arrives and how §10.3
  describes the teacher's day. Phase 9 gave students a login and a read-only
  view of their marks; uploading an answer needs the Files adapter, which is
  not built.
- **Report cards are not built.** Examcell now produces exam marks and the
  LMS produces assignment marks, but nothing combines them into a term
  report with a grading scale, remarks and a printable layout — that needs a
  school-specific grading policy (11.14) rather than a guess.
- **The gradebook shows percentages, not letter grades.** Deliberate: 11.14
  says to "support curriculum-specific grading engines rather than
  hard-coding one grading model", and CBSE, IB and Cambridge disagree about
  what 78% is called. A grading engine per curriculum is the right home for
  that.
- **Lesson content is plain text.** File and video resources need the Files
  storage adapter; `LessonResource` exists and nothing writes it.
- **The public enquiry form has no OTP and no CAPTCHA.** Blueprint 10.5 wants
  mobile/email OTP validation; that needs an SMS/email provider (Phase 6
  Connect). Today it has a honeypot, a per-IP rate limit (in-process — move
  it to Redis before running more than one server), and silent duplicate
  absorption. WhatsApp/campaign messaging and the chatbot are Phase 6 too.
- **Admission doesn't collect a fee.** Blueprint 10.2 puts "fee payment"
  between offer and enrollment; conversion creates the student directly and
  an invoice is raised separately afterwards. Wiring conversion straight
  into `raiseInvoice` is the obvious next step — the hook is
  `Application.convertedStudentId`.
- **No payment gateway, and `ONLINE` is a manual entry.** `recordPayment`
  is provider-agnostic and already takes a reference; a real gateway needs
  the adapter plus a webhook that calls the same function (blueprint 10.6's
  "payment gateway webhook verifies transaction"). Daily reconciliation
  against bank/gateway statements (`ReconciliationRecord` exists, unused)
  and PDC handling are not built.
- **Invoice numbers are allocated by counting.** `raiseInvoice` counts
  existing invoices and retries on the unique-constraint violation. That is
  correct under concurrency but not gapless; a Postgres sequence per
  organization is the better answer if the numbering must satisfy an
  auditor.
- **The ledger is minimal by design.** Three accounts (Cash, Bank, Fee
  income), postings only for payments and refunds. No expenses, payroll
  journal, period close, or statement of accounts — those follow the modules
  that generate them.
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
