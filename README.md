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

15. **Files — working.** A storage adapter that actually stores: uploads are
    validated against an ALLOW-list of formats a school needs (HTML, SVG and
    scripts are refused — served from this origin they would run as the
    viewer), the browser-supplied MIME type must agree with the extension,
    filenames are sanitised to labels and never become paths, and the storage
    key is server-generated from a UUID. Bytes live outside the web root,
    every read verifies the SHA-256 recorded at upload, and every download
    goes out as `application/octet-stream` with `Content-Disposition:
    attachment` and nosniff. Identical bytes are de-duplicated; archiving is
    a soft delete because a document attached to an application is evidence.
    Gated by `files.storage` and 3 `files.*` permissions. Code in
    `src/modules/files/`.

16. **Staff self-service — working.** `/my/leave` shows a staff member their
    own leave and their own processed payslips, and lets them file leave for
    themselves. It takes NO HR permission: the action has no staffId
    parameter at all, so a request on a colleague's behalf is not refused —
    it is unexpressible. The README previously framed this as needing "an
    attribute policy scoping `hr.leave`", which was the wrong shape:
    `hr.leave` is the permission to administer *other* people's leave, and
    granting it to every teacher is unsafe however it is scoped. Code in
    `src/modules/hr/self.ts`.

17. **Canteen — working.** A prepaid wallet per student with an append-only
    transaction ledger, a menu, and a till. A wallet can never go negative: a
    canteen is not a credit facility, and a child who has run out should be
    told at the till rather than discover a debt at the end of term. The
    basket sends item ids and quantities only — prices are read from the menu
    server-side and copied onto the sale line, so a tampered form cannot set
    them and a later menu change never rewrites what a family was charged.
    Deliberately OUTSIDE the fee ledger: canteen money is a float a family
    tops up, not revenue recognised against an invoice. Gated by 3
    `ops.canteen:*` permissions. Code in `src/modules/canteen/`.

18. **Report cards — working.** A configurable **grading scale** (bands are
    DATA, because a CBSE school, an IB school and a state-board school
    disagree about what 72% is called and none of them are wrong), and term
    reports that combine **Examcell marks and LMS coursework** with
    attendance into a printable card. Every figure is a SNAPSHOT copied at
    generation, so a gradebook corrected next month never changes a report a
    family already has; a published report cannot be regenerated. Published
    reports appear in the parent portal. Gated by `reporting.cards` and 4
    permissions. Code in `src/modules/reporting/`.

19. **Student submissions — working.** Students hand in their own work from
    the portal, with a written answer, a file, or both, reusing the Files
    module's validation wholesale. Only a STUDENT may submit — a parent sees
    the marks but handing in is not theirs to do — only for an assignment
    published to their own section (resolved from their record, never the
    form), and never after a teacher has graded it. Late work is recorded,
    not refused: whether a late hand-in counts is a teacher's decision. The
    grading roster shows what was handed in, so nobody is asked to mark work
    they cannot read.

20. **Automation — working, for the half that did not exist.** Blueprint §12
    warns "do not build each module's approvals and notifications
    separately", and this codebase did exactly that. This engine does **not**
    retrofit those six approval flows — rewriting working code to gain
    uniformity nobody has asked for would risk all six. What it adds is
    **trigger → condition → action**: a school can say "when a payment over
    ₹1,000 is received, thank the family" without anyone writing code.
    Conditions compare numerically when both sides are numbers (so `9 > 10`
    is false, not true), a missing fact is always false so a rule never
    fires by accident, and an unknown `{{placeholder}}` is left visible so a
    broken rule looks broken. Every evaluation is recorded, matched or not,
    so "why didn't my rule fire?" has an answer. Emitting is best-effort:
    a rule can never roll back the payment that triggered it. Gated by
    `automation.rules`. Code in `src/modules/automation/`.

21. **Scheduler — working.** A tick, not a daemon: something outside the app
    (a platform cron, a systemd timer, or `npm run scheduler`) calls
    `/api/cron/tick` every minute with `Authorization: Bearer $CRON_SECRET`,
    and each tick runs whichever jobs are due. That shape survives every way
    the app can be deployed — a timer inside a web process runs once per
    instance, which for "text every family whose fee is due" is exactly the
    wrong number of times. The endpoint fails closed without a 32+ character
    secret. Two jobs:
    - **Deliver held messages** (every 5 minutes) — the queue worker Connect
      always assumed and never had. Messages held back by quiet hours now
      carry a `notBefore` and are sent when it passes; broadcasts scheduled by
      a person, or deferred by quiet hours, go out at their time. Each message
      is claimed with a conditional update before it is sent, so two runners
      can't both send it.
    - **Date-based automation rules** (hourly) — "3 days before an invoice
      falls due", "7 days after, if still unpaid", "a library book is 3 days
      overdue". Each (rule, invoice) is recorded under a unique key BEFORE
      the message goes, so an hourly re-run — or two overlapping runners —
      acts once, never twice. An overdue rule looks back at most three days
      past its line, so creating one never texts every family with last
      year's debt at once.

    A lease row taken by conditional update keeps one runner per job across
    instances; `/automation/scheduler` shows whether the scheduler is actually
    ticking (and says so loudly when it has never run), lets an administrator
    run a job for their own school, and itemises only that school's runs.
    Along the way: quiet hours are now read on the campus clock
    (`Branch.timezone`) instead of UTC, scheduled broadcast times are the
    campus wall-clock time that was typed, "notify me" notifies the rule's
    author rather than whoever triggered the event, and four triggers the
    rule form had always offered — enrolment, invoice raised, absence, leave
    approved — are finally emitted. Code in `src/modules/scheduler/`,
    `src/modules/automation/scheduled.service.ts`,
    `src/modules/connect/deferred.service.ts`.

22. **Family onboarding and password reset — working.** Portal logins used
    to exist only because the seed created them. Now the Student 360 shows
    each guardian's portal status (no login / invited / active / withdrawn)
    and, for staff holding the new `sis.portal_access:edit` permission
    (admins, principal, front office), invites a guardian — or an enrolled
    student, with a school-assigned address — to set their OWN password
    through a one-time link. Staff never type a family's password.
    - **Links are credentials, treated as such.** 256-bit random tokens;
      only their SHA-256 is stored, so a database dump signs nobody in.
      Single use (claimed by a conditional update in the same transaction
      as the password write), 7 days for an invitation, 1 hour for a reset,
      and issuing a new one revokes the old. The delivery log records that a
      link was sent but never the link, because front-office staff can read
      that log.
    - **Forgot password** (`/forgot-password`) answers identically for
      known and unknown addresses — in words and, padded to a floor, in
      time — and is throttled per IP+address and per IP. Links are built
      from `APP_URL`/`AUTH_URL`, never the request's Host header, which is
      what makes "password reset poisoning" impossible.
    - **A reset really locks people out.** `User.passwordChangedAt` is
      compared with each session's sign-in time on every request, so every
      session opened with the old password ends.
    - **Withdrawing access** revokes the portal role, and disables the login
      only if it holds nothing else — a teacher whose child has left keeps
      their staff access.
    - Passwords: 10+ characters, at most 72 bytes (bcrypt silently ignores
      the rest), not on the obvious lists (including this system's own demo
      password), not built from the person's email or name.

    Without an email provider nothing can arrive, so an invitation shows its
    link to the member of staff to hand over; a RESET link is never shown
    to staff (that account already works, and a link on a staff screen is a
    way into it) and in development is printed to the server console only.
    Code in `src/modules/identity/portal-access.service.ts`,
    `src/lib/auth-tokens.ts`, `src/app/invite/`, `src/app/reset-password/`,
    `src/app/forgot-password/`.

23. **Weighted report cards and subject comments — working.** Report cards
    used to add exam and coursework marks together, and said so, because a
    weighting is school policy. The weighting is now policy the SCHOOL sets:
    a grading scale can carry "exams 80, coursework 20" (or none, which keeps
    marks added together), and administrators create scales — bands pasted
    one per line, every bad line reported by number — and choose which is the
    default for new reports.
    - **Weighted means percentages first.** 7/10 in exams and 17/20 in
      coursework is 73% at 80/20, whatever each was marked out of; the
      overall figure then counts every subject equally.
    - **Missing evidence is said, not hidden.** A subject with only
      coursework at 80/20 is graded on the coursework, and the printed line
      reads "Coursework only — no exams marked, so the 80/20 weighting
      couldn't apply" — rather than capping the child at 20% for exams nobody
      set. A component the scale weights at zero never produces a grade alone.
    - **Snapshots include the policy.** Each report copies the weighting it
      was made with, so a published Term 1 report made before a school
      switched to 80/20 still reads, and prints, exactly as it did.
    - **Subject teachers' comments** are written on the draft and survive
      regenerating it (a corrected mark no longer costs a class teacher an
      evening of rewriting). A comment whose subject has dropped off is named
      rather than lost. Publishing freezes figures and comments together —
      the draft check is repeated inside the save's transaction, so a publish
      at the same moment wins. Teachers comment only on their own sections,
      and the report page now enforces that for a typed URL too.

    Code in `src/modules/reporting/weighting.ts`,
    `src/modules/reporting/band-input.ts`,
    `src/modules/reporting/report-cards.service.ts`.

24. **Lesson registers and cover — working.** Two blueprint 11.3/11.4
    items that the daily register had deferred.
    - **Period-wise attendance** (`/academics/periods`): a register per
      timetabled lesson per day, kept SEPARATE from the daily register, which
      stays the official record that absence notices, summaries and report
      cards read. Each row shows what the daily register says, and a child
      marked present this morning but absent from this lesson is highlighted —
      that gap is the point. A teacher sees their own day (their lessons plus
      any they're covering); an administrator picks a section. Only the
      lesson's teacher for the day may take its register, on the day; a past
      lesson needs approval rights, a future one can't be taken at all.
      Families are not messaged from here: the daily register already tells
      them once.
    - **Cover** (`/academics/substitutions`, new
      `academics.substitutions` permission for leadership): the day's
      lessons, with those whose teacher is on approved leave and uncovered
      at the top. For any lesson — including one whose teacher phoned in sick
      without filing leave — it ranks every active member of staff: free
      people first (not teaching then, not already covering, not on leave),
      subject specialists, then people who know the class, then the lightest
      day; the unavailable are listed with the reason. Assigning re-checks
      availability against fresh data under a Postgres advisory lock on
      (substitute, date), so two coordinators can't give one teacher two
      overlapping lessons at once. The substitute is notified, and the
      lesson's register becomes theirs — not the absent teacher's.

    Code in `src/modules/academics/substitution.ts` (pure),
    `substitutions.service.ts`, `period-attendance.service.ts`.

## Known limitations / follow-ups

- **Phase 9 is a responsive web portal, not native apps.** There is no React
  Native, no app store build, no push notification and no offline mode. The
  blueprint's "driver experience" here is a read-only manifest — there is no
  GPS, no live tracking and no boarding scan.
- **The portal is read-only apart from handing in work.** A parent can see
  dues but cannot pay (no gateway), and nobody can update their own contact
  details. Student submission is the one write, and it is the student's
  alone — a parent cannot submit on their behalf.
- **Onboarding and reset need an email provider to be real.** The flows work
  end to end, but with only the recording adapter no email leaves the
  system: invitation links are handed over by staff, and a family member who
  forgets their password must ask the office (whose reset can't arrive
  either). There is still no OTP, no 2FA, no bulk "invite every guardian in
  Grade 5", and a guardian without an email address on file can't be
  invited at all — phone-number sign-in would need an SMS provider.
- **Automation's only actions are notifications.** It cannot assign a task,
  update a field or call a webhook, and date-based triggers cover invoices
  and library loans only (no "assignment due tomorrow" yet). The per-module
  approvals (student leave, staff leave, refunds, admissions, payroll, report
  cards) remain separate implementations, which is the §12 gap still open.
- **Scheduled work is at-most-once, by choice.** A runner that dies between
  claiming a message (or a rule's invoice) and sending it loses that one
  message rather than risking a duplicate; the delivery log shows it as
  QUEUED with no send time. There is no retry or dead-letter queue, and a
  provider outage during a tick fails those messages rather than holding
  them. The scheduler only runs if something calls `/api/cron/tick` — see
  the operations runbook.
- **Report card weighting is exam vs coursework, per scale — nothing finer.**
  A school can say "exams 80, coursework 20", but not "Science practicals
  count double" or "Term 1 is 40% of the annual". Scales can be created and
  made default, not edited — a new scale is the way to change one, which
  keeps every existing report explainable. There is no co-scholastic section
  (art, conduct, sport), and no bulk "generate for the whole section".
- **"Store" is the same table as inventory.** The blueprint names both; the
  schema has one InventoryItem and there is no meaningful difference between
  a stationery store and a stock list, so they were not split.
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
- **An immediate send still happens in the request.** Held and scheduled
  messages are swept by the scheduler, but pressing Send on a broadcast loops
  over its audience in-request — fine for a class, wrong for 4,000
  guardians. Moving that onto the scheduler (or a real queue) is the next
  step; retries and dead-lettering likewise.
- **OTP and WhatsApp templates still aren't real.** Phase 3's public form
  wants OTP; both need a live provider plus (for WhatsApp) template
  pre-approval by Meta.
- **Quiet hours are one window per organization, read on each campus's
  clock.** A group whose campuses keep different hours can't set different
  windows per campus. Exam start times are still entered and shown in UTC
  (the exam form says so); only Connect and the scheduler use
  `Branch.timezone` so far.
- **Phase 10+ tables have no RBAC permissions yet.** `src/lib/permissions.ts`
  lists foundation, SIS, Academics, Admissions, Finance, LMS, Connect, HR
  and Operations modules. Adding a module's permissions belongs with the
  code that first checks them.
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
- **Lesson registers sit beside the daily register, and cover is
  lesson-by-lesson.** A period register never changes the official daily
  one, never messages families, and isn't counted in report-card
  attendance. Cover is arranged one lesson on one day at a time: there's no
  "cover all of Ravi's lessons this week" in one step, no cover rota, no
  cap on how many covers one person can be given, and no temporary timetable
  change beyond a single lesson.
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
