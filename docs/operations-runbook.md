# Operations runbook

Blueprint Phase 12 asks for security, performance, disaster recovery,
observability, accessibility and rollout. This is the operational half:
what to do, in what order, when something is wrong.

It describes the system **as it actually is today**, including the parts
that are not ready. Anything marked **NOT READY** must be built before this
holds real school data.

---

## 1. Health and observability

| Signal | Where | Expected |
| --- | --- | --- |
| Liveness / readiness | `GET /api/health` | `200 {"status":"ok"}`; `503` when the database is unreachable |
| Audit trail | `AuditEvent` table, `/settings` → audit views | every mutation, append-only |
| AI cost | `/ai/usage` | tokens per capability |
| Failed sign-ins | `AuditEvent` where `action = 'user.login_failed'` | investigate a burst against one address |
| Throttled sign-ins | `AuditEvent` where `action = 'auth.rate_limited'` | a burst on one email is an attack in progress |

`/api/health` is unauthenticated by necessity, so it deliberately returns
nothing but a status and a latency — no version, no migration state, no
counts.

**NOT READY:** there is no metrics endpoint, no tracing, no log aggregation
and no alerting. Nothing pages anyone. A deployment needs these before it
runs unattended — wire the health endpoint to an uptime check as the bare
minimum.

---

## 2. Backup and restore

The entire application state is in one Postgres database. There is no other
durable store — no object storage, no queue, no cache holding anything that
cannot be recomputed — so a database backup is a complete backup.

**Backup**

```bash
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" > mcbpulse-$(date +%F).dump
```

**Restore into an empty database**

```bash
createdb mcbpulse_restore
pg_restore --no-owner --no-privileges --dbname "$RESTORE_URL" mcbpulse-2026-09-14.dump
npx prisma migrate deploy     # brings a restored older dump up to current schema
```

**Verify a restore actually worked** — a backup nobody has restored is a
hypothesis, not a backup:

```bash
psql "$RESTORE_URL" -c "select count(*) from \"Student\"; select count(*) from \"AuditEvent\"; select max(\"createdAt\") from \"AuditEvent\";"
```

Then point a staging instance at it and sign in. Restore drills belong on a
schedule.

**Recovery targets:** none are contractually defined yet. With a nightly
dump the effective RPO is up to 24 hours and the RTO is however long a
restore takes. If a school needs better, turn on continuous archiving
(WAL-E / pgBackRest) — that is a Postgres configuration change, not an
application change.

---

## 3. Migrations

**Never run `prisma migrate dev` against a shared or production database,
and never `CREATE DATABASE` / `DROP DATABASE` on the local `prisma dev`
engine** — see the incident note in the README. Author migrations with a
diff and apply them with deploy:

```bash
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma \
  --script -o prisma/migrations/$(date +%Y%m%d%H%M%S)_name/migration.sql
npx prisma migrate deploy
```

**Rollback plan.** Migrations so far are additive (new tables, new nullable
columns), so the rollback is to deploy the previous application build and
leave the schema alone — an older build ignores a column it does not know
about. A destructive migration (a dropped column, a narrowed type) has no
such escape and needs a restore from backup; do not write one without
planning that first.

---

## 4. Security posture

**In place**

- Passwords hashed with bcrypt (cost 12); no password is ever logged.
- Sessions are JWTs, re-validated against the database on every request
  (`getViewerContext`), so disabling a user takes effect immediately rather
  than at token expiry.
- RBAC on every route and every server action, plus two attribute policies
  (section-scoped teachers, self-scoped parents/students/drivers).
- Server actions re-check the branch named in the form, so a tampered hidden
  field cannot write into another branch.
- Login throttling: 8 attempts per 10 minutes per IP+email, cleared on a
  successful sign-in. Identical error message whether the email is unknown
  or the password is wrong, so it is not a user-enumeration oracle.
- Public enquiry form: honeypot, per-IP throttle, duplicate absorption that
  never reveals whether a number is known.
- CSP, HSTS, `frame-ancestors 'none'`, `form-action 'self'`, nosniff,
  referrer policy, permissions policy. No `X-Powered-By`.
- AI: capability-level permissions, redaction before egress, untrusted-data
  fencing, full audit.
- Append-only audit log with no update or delete helper anywhere in the code.

**NOT READY — build before production**

- **Two-factor authentication.** Not built. An org-admin account is one
  password away from every record in the tenant.
- **CSP still allows `'unsafe-inline'` for scripts**, because Next's App
  Router inlines a bootstrap script and there is no nonce plumbing yet.
  This is the single biggest remaining XSS mitigation gap.
- **Rate limiting is per process.** Behind two instances a caller gets two
  buckets, and counts reset on deploy. Move `src/lib/rate-limit.ts` to Redis
  before scaling out.
- **No secret rotation procedure**, no KMS, no encryption at rest beyond
  whatever the database provides.
- **No penetration test.** Nothing here has been reviewed by anyone else.
- Password policy is minimum-length only: no complexity rule, no breach-list
  check, no expiry, no reset flow.

---

## 5. Performance

Known and deliberate:

- Every list query is capped (`take`), so no page can be made to load an
  entire table.
- Report date ranges are capped at 400 days for the same reason.
- The database pool is capped at 5 with keep-alive.
- There is deliberately **no blanket query retry**: retrying a write whose
  outcome is unknown risks charging someone twice, which is worse than a
  500 the user can refresh past.

**NOT READY:** no load test has been run, no query has been profiled against
a realistic dataset, and the N+1 risk in the cross-module dashboard has not
been measured. The figures are correct; their cost at 10,000 students is
unknown.

---

## 6. Accessibility

In place: semantic landmarks, a skip link on both shells, labelled form
controls, `role="alert"` on every error, focus-visible styling from the
browser default, colour never used as the only signal (every badge carries
text), and a layout that reflows to 375px without horizontal scroll.

**NOT READY:** no screen-reader pass, no automated axe run in CI, and the
colour contrast of the muted `zinc-400` text on white has not been measured
against WCAG AA.

---

## 7. Incident checklist

1. Check `/api/health` on each instance.
2. Check the audit log for a burst of `auth.rate_limited` or `user.login_failed`.
3. If data looks wrong, **do not repair it by hand first** — capture what
   the audit log says happened, then repair.
4. To lock an account out immediately, set `User.status = 'DISABLED'`; the
   next request re-validates and the session dies.
5. To take a module out of service for one organization, switch its feature
   flag off in `/settings` — it is one row and it takes effect on the next
   request.
