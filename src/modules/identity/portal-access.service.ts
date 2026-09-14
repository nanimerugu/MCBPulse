import "server-only";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { appBaseUrl } from "@/lib/app-url";
import {
  checkNewPassword,
  generateToken,
  hashToken,
  INVITE_TTL_MS,
  looksLikeToken,
  maskEmail,
  RESET_TTL_MS,
  TOKEN_STATE_MESSAGES,
  tokenState,
} from "@/lib/auth-tokens";
import { sendSecurityMessage } from "@/modules/connect/transactional";
import { SisError, type Actor } from "@/modules/sis/students.service";

/**
 * How a family gets a login — and loses one.
 *
 * Before this, portal logins existed only because the seed script created
 * them. Now a member of staff invites a guardian (or a student) from the
 * Student 360; the person gets a one-time link, sets their own password, and
 * the school never knows it. Staff never type a family's password, and
 * nobody can use a link twice.
 *
 * Tenancy: every target is resolved THROUGH the actor's organization (a
 * guardian via a student link in that organization), so an id from another
 * school is "not found", never a login for the wrong family.
 */

export type PortalRoleKey = "parent" | "student";

export type PortalTarget = { kind: "guardian"; guardianId: string; studentId: string } | { kind: "student"; studentId: string };

export type PortalAccess =
  | { state: "none" }
  | { state: "invited"; email: string; expiresAt: Date | null }
  | { state: "active"; email: string; lastLoginAt: Date | null }
  | { state: "withdrawn"; email: string };

const roleKeyOf = (target: PortalTarget): PortalRoleKey => (target.kind === "guardian" ? "parent" : "student");

interface ResolvedTarget {
  roleKey: PortalRoleKey;
  name: string;
  email: string | null;
  userId: string | null;
  linkUser(tx: TxClient, userId: string): Promise<unknown>;
}

type TxClient = Parameters<Parameters<typeof db.$transaction>[0]>[0];

async function resolveTarget(target: PortalTarget, organizationId: string): Promise<ResolvedTarget> {
  if (target.kind === "guardian") {
    const link = await db.studentGuardian.findFirst({
      where: { guardianId: target.guardianId, studentId: target.studentId, student: { organizationId, deletedAt: null } },
      include: { guardian: true },
    });
    if (!link || link.guardian.deletedAt) throw new SisError("Guardian not found");
    const g = link.guardian;
    return {
      roleKey: "parent",
      name: `${g.firstName} ${g.lastName}`.trim(),
      email: g.email?.trim().toLowerCase() || null,
      userId: g.userId,
      linkUser: (tx, userId) => tx.guardian.update({ where: { id: g.id }, data: { userId } }),
    };
  }
  const s = await db.student.findFirst({ where: { id: target.studentId, organizationId, deletedAt: null } });
  if (!s) throw new SisError("Student not found");
  return {
    roleKey: "student",
    name: `${s.firstName} ${s.lastName}`.trim(),
    email: null,
    userId: s.userId,
    linkUser: (tx, userId) => tx.student.update({ where: { id: s.id }, data: { userId } }),
  };
}

async function portalRole(roleKey: PortalRoleKey) {
  const role = await db.role.findFirst({ where: { organizationId: null, key: roleKey, isSystem: true, deletedAt: null } });
  if (!role) throw new SisError(`The ${roleKey} role is missing — run the seed`);
  return role;
}

/** Portal status for a set of logins, as the Student 360 shows it. */
export async function portalAccessByUser(userIds: string[], roleKey: PortalRoleKey, organizationId: string): Promise<Map<string, PortalAccess>> {
  const out = new Map<string, PortalAccess>();
  if (userIds.length === 0) return out;
  const now = new Date();
  const users = await db.user.findMany({
    where: { id: { in: userIds }, deletedAt: null },
    select: {
      id: true,
      email: true,
      status: true,
      passwordHash: true,
      lastLoginAt: true,
      roleAssignments: { where: { organizationId, role: { key: roleKey } }, select: { revokedAt: true } },
      authTokens: { where: { purpose: "INVITE", usedAt: null, revokedAt: null }, orderBy: { createdAt: "desc" }, take: 1, select: { expiresAt: true } },
    },
  });
  for (const u of users) {
    const granted = u.roleAssignments.some((a) => a.revokedAt === null);
    if (u.roleAssignments.length === 0) {
      // A login that never held this role here (a teacher who is also a parent).
      out.set(u.id, { state: "none" });
    } else if (!granted || u.status === "DISABLED") {
      out.set(u.id, { state: "withdrawn", email: u.email });
    } else if (u.status === "ACTIVE" && u.passwordHash) {
      out.set(u.id, { state: "active", email: u.email, lastLoginAt: u.lastLoginAt });
    } else {
      const pending = u.authTokens[0];
      out.set(u.id, { state: "invited", email: u.email, expiresAt: pending && pending.expiresAt > now ? pending.expiresAt : null });
    }
  }
  return out;
}

export interface InviteOutcome {
  email: string;
  /** True only when a real provider accepted the email. */
  delivered: boolean;
  /**
   * The link, returned ONLY when no provider could deliver it, so the member
   * of staff can hand it over. With a live email provider it is never shown
   * to anyone but its recipient.
   */
  link: string | null;
  /** They already had a working password; access was simply restored. */
  restored: boolean;
}

export async function invitePortalUser(target: PortalTarget, studentEmail: string | undefined, actor: Actor): Promise<InviteOutcome> {
  const organizationId = actor.organizationId;
  const resolved = await resolveTarget(target, organizationId);
  const role = await portalRole(resolved.roleKey);

  const email = (target.kind === "student" ? studentEmail?.trim().toLowerCase() : resolved.email) || null;
  if (!email) {
    throw new SisError(
      target.kind === "guardian"
        ? `Add an email address for ${resolved.name} first — it becomes their sign-in name`
        : "Enter the email address the student will sign in with",
    );
  }
  if (target.kind === "student") {
    const student = await db.student.findUnique({ where: { id: target.studentId }, select: { status: true } });
    if (student?.status !== "ENROLLED") throw new SisError("Only an enrolled student can be given a login");
  }

  const now = new Date();
  const result = await db.$transaction(async (tx) => {
    let user = resolved.userId ? await tx.user.findUnique({ where: { id: resolved.userId } }) : null;

    if (user) {
      if (user.email !== email) {
        const clash = await tx.user.findUnique({ where: { email } });
        if (clash && clash.id !== user.id) throw new SisError("That email address already signs in to a different account");
        user = await tx.user.update({ where: { id: user.id }, data: { email } });
      }
    } else {
      // Deliberately NOT attaching to an existing account that happens to use
      // this address. Doing so would hand this child's records to whoever
      // controls that account on the strength of one typed field.
      if (await tx.user.findUnique({ where: { email } })) {
        throw new SisError("That email address already signs in to an account. Use a different address, or ask an administrator to link that account.");
      }
      user = await tx.user.create({ data: { email, name: resolved.name, status: "INVITED" } });
      await resolved.linkUser(tx, user.id);
    }

    const assignment = await tx.roleAssignment.findFirst({ where: { userId: user.id, roleId: role.id, organizationId } });
    const hasWorkingLogin = user.status === "ACTIVE" && Boolean(user.passwordHash);
    if (hasWorkingLogin && assignment && assignment.revokedAt === null) {
      throw new SisError(`${resolved.name} already has portal access — send a password reset if they've forgotten it`);
    }
    if (!assignment) {
      await tx.roleAssignment.create({ data: { userId: user.id, roleId: role.id, organizationId, branchId: null } });
    } else if (assignment.revokedAt) {
      await tx.roleAssignment.update({ where: { id: assignment.id }, data: { revokedAt: null } });
    }

    // Someone who can already sign in (a teacher who is also a parent, say)
    // just gets the role back — no new password, no link.
    if (hasWorkingLogin) return { user, token: null };

    // Otherwise a fresh start: a withdrawn login's old password must not
    // come back to life with the access.
    if (user.status !== "INVITED" || user.passwordHash) {
      user = await tx.user.update({ where: { id: user.id }, data: { status: "INVITED", passwordHash: null } });
    }
    await tx.authToken.updateMany({ where: { userId: user.id, purpose: "INVITE", usedAt: null, revokedAt: null }, data: { revokedAt: now } });
    const { token, tokenHash } = generateToken();
    await tx.authToken.create({
      data: { userId: user.id, purpose: "INVITE", tokenHash, expiresAt: new Date(now.getTime() + INVITE_TTL_MS), organizationId, createdByUserId: actor.userId },
    });
    return { user, token };
  });

  let delivered = false;
  let link: string | null = null;
  if (result.token) {
    const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
    const schoolName = org?.name ?? "Your school";
    link = `${appBaseUrl()}/invite/${result.token}`;
    const intro = resolved.roleKey === "parent" ? "the family portal, where you can follow attendance, homework, fees and reports" : "the student portal";
    const sent = await sendSecurityMessage({
      organizationId,
      to: email,
      recipientName: resolved.name,
      subject: `${schoolName}: set up your portal login`,
      body: `${schoolName} has invited you to ${intro}. Choose your password within 7 days: ${link}\n\nIf you weren't expecting this, you can ignore it.`,
      logBody: `${schoolName} has invited you to ${intro}. Choose your password within 7 days: [one-time link — withheld from this log]`,
    });
    delivered = sent.delivered;
  }

  await recordAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    action: result.token ? "portal_access.invited" : "portal_access.restored",
    resourceType: target.kind === "guardian" ? "guardian" : "student",
    resourceId: target.kind === "guardian" ? target.guardianId : target.studentId,
    // Never the token or the link. The email is already on the guardian record.
    after: { role: resolved.roleKey, email, userId: result.user.id, delivered },
  });
  // Mirrored on the student's timeline, where staff actually look.
  if (target.kind === "guardian") {
    await recordAuditEvent({
      organizationId,
      actorUserId: actor.userId,
      action: result.token ? "guardian.portal_invited" : "guardian.portal_restored",
      resourceType: "student",
      resourceId: target.studentId,
      after: { guardian: resolved.name },
    });
  }

  return { email, delivered, link: delivered ? null : link, restored: !result.token };
}

/**
 * Take portal access away. Revokes the portal ROLE, not necessarily the
 * login: a teacher whose child has left keeps their staff access. Only a
 * login with nothing else left is disabled — which ends its sessions on the
 * next request, since every request re-checks the user.
 */
export async function withdrawPortalAccess(target: PortalTarget, actor: Actor): Promise<{ loginDisabled: boolean }> {
  const organizationId = actor.organizationId;
  const resolved = await resolveTarget(target, organizationId);
  if (!resolved.userId) throw new SisError(`${resolved.name} has no portal login to withdraw`);
  const role = await portalRole(roleKeyOf(target));
  const userId = resolved.userId;
  const now = new Date();

  const loginDisabled = await db.$transaction(async (tx) => {
    await tx.roleAssignment.updateMany({ where: { userId, roleId: role.id, organizationId, revokedAt: null }, data: { revokedAt: now } });
    await tx.authToken.updateMany({ where: { userId, usedAt: null, revokedAt: null }, data: { revokedAt: now } });
    const remaining = await tx.roleAssignment.count({ where: { userId, revokedAt: null } });
    if (remaining === 0) {
      await tx.user.update({ where: { id: userId }, data: { status: "DISABLED" } });
      return true;
    }
    return false;
  });

  await recordAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    action: "portal_access.withdrawn",
    resourceType: target.kind === "guardian" ? "guardian" : "student",
    resourceId: target.kind === "guardian" ? target.guardianId : target.studentId,
    after: { role: resolved.roleKey, userId, loginDisabled },
  });
  return { loginDisabled };
}

// --- Password reset ------------------------------------------------------------

async function issueReset(user: { id: string; email: string; name: string }, createdByUserId: string | null): Promise<{ delivered: boolean }> {
  const now = new Date();
  const { token, tokenHash } = generateToken();
  const membership = await db.roleAssignment.findFirst({ where: { userId: user.id, revokedAt: null }, orderBy: { createdAt: "asc" }, select: { organizationId: true } });

  await db.$transaction(async (tx) => {
    await tx.authToken.updateMany({ where: { userId: user.id, purpose: "PASSWORD_RESET", usedAt: null, revokedAt: null }, data: { revokedAt: now } });
    await tx.authToken.create({
      data: { userId: user.id, purpose: "PASSWORD_RESET", tokenHash, expiresAt: new Date(now.getTime() + RESET_TTL_MS), createdByUserId },
    });
  });

  const link = `${appBaseUrl()}/reset-password/${token}`;
  const sent = await sendSecurityMessage({
    organizationId: membership?.organizationId ?? null,
    to: user.email,
    recipientName: user.name,
    subject: "Reset your MCBPulse password",
    body: `Someone asked to reset the password for this account. If it was you, choose a new one within the hour: ${link}\n\nIf it wasn't, ignore this email — your password hasn't changed.`,
    logBody: "Password reset link sent: [one-time link — withheld from this log]",
  });

  if (!sent.delivered && process.env.NODE_ENV !== "production") {
    // Development has no email provider, and a reset flow nobody can test is
    // a reset flow nobody tests. Printed to the SERVER console only, never in
    // production, and never into the database.
    console.info(`[auth] DEV ONLY — no email provider configured; reset link for ${maskEmail(user.email)}: ${link}`);
  }
  return { delivered: sent.delivered };
}

/**
 * The public "forgot password" request. Returns nothing, on purpose: the page
 * says the same thing whether or not the address has an account, or this is
 * a user-enumeration oracle.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  const user = await db.user.findFirst({
    where: { email: normalized, status: "ACTIVE", deletedAt: null, passwordHash: { not: null } },
    select: { id: true, email: true, name: true },
  });
  await recordAuditEvent({
    action: "auth.password_reset_requested",
    resourceType: "user",
    resourceId: user?.id ?? null,
    // The typed address is not stored for a miss: it may be anyone's.
    after: { matched: Boolean(user) },
  });
  if (user) await issueReset(user, null);
}

/** A member of staff sends a reset to a family member who has forgotten their password. */
export async function sendPortalPasswordReset(target: PortalTarget, actor: Actor): Promise<{ email: string; delivered: boolean }> {
  const resolved = await resolveTarget(target, actor.organizationId);
  if (!resolved.userId) throw new SisError(`${resolved.name} has no portal login yet — invite them instead`);
  const user = await db.user.findFirst({ where: { id: resolved.userId, deletedAt: null }, select: { id: true, email: true, name: true, status: true, passwordHash: true } });
  if (!user || user.status !== "ACTIVE" || !user.passwordHash) throw new SisError(`${resolved.name} hasn't set a password yet — resend the invitation instead`);

  // Deliberately does NOT hand the link to the member of staff, unlike an
  // invitation: this account already works, and a reset link shown on a
  // staff screen is a way to sign in as that parent.
  const { delivered } = await issueReset(user, actor.userId);
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "portal_access.reset_sent",
    resourceType: target.kind === "guardian" ? "guardian" : "student",
    resourceId: target.kind === "guardian" ? target.guardianId : target.studentId,
    after: { userId: user.id, delivered },
  });
  return { email: user.email, delivered };
}

// --- Using a link ----------------------------------------------------------------

export type LinkPurpose = "INVITE" | "PASSWORD_RESET";

const BAD_LINK = "This link isn't valid. Check you copied all of it, or ask for a new one.";

export async function inspectLink(raw: string, purpose: LinkPurpose): Promise<{ ok: true; maskedEmail: string; firstName: string } | { ok: false; message: string }> {
  if (!looksLikeToken(raw)) return { ok: false, message: BAD_LINK };
  const row = await db.authToken.findUnique({ where: { tokenHash: hashToken(raw) }, include: { user: { select: { email: true, name: true, status: true, deletedAt: true } } } });
  if (!row || row.purpose !== purpose || row.user.deletedAt) return { ok: false, message: BAD_LINK };
  const state = tokenState(row, new Date());
  if (state !== "usable") return { ok: false, message: TOKEN_STATE_MESSAGES[state] };
  if (row.user.status === "DISABLED") return { ok: false, message: "This account's access has been withdrawn. Contact the school office." };
  return { ok: true, maskedEmail: maskEmail(row.user.email), firstName: row.user.name.split(/\s+/)[0] ?? "" };
}

export type CompleteResult = { ok: true } | { ok: false; message: string; retryable: boolean };

/**
 * Set a password with a one-time link — accepting an invitation or finishing
 * a reset. The token is consumed by a conditional update in the SAME
 * transaction as the password write, so a link clicked twice at once sets
 * one password, not two, and a failure part-way leaves the link usable.
 */
export async function completeWithLink(raw: string, purpose: LinkPurpose, password: string, confirm: string): Promise<CompleteResult> {
  if (!looksLikeToken(raw)) return { ok: false, message: BAD_LINK, retryable: false };
  const row = await db.authToken.findUnique({ where: { tokenHash: hashToken(raw) }, include: { user: true } });
  if (!row || row.purpose !== purpose || row.user.deletedAt) return { ok: false, message: BAD_LINK, retryable: false };

  const now = new Date();
  const state = tokenState(row, now);
  if (state !== "usable") return { ok: false, message: TOKEN_STATE_MESSAGES[state], retryable: false };
  const requiredStatus = purpose === "INVITE" ? "INVITED" : "ACTIVE";
  if (row.user.status !== requiredStatus) {
    return {
      ok: false,
      message: row.user.status === "DISABLED" ? "This account's access has been withdrawn. Contact the school office." : "This account is already set up — sign in instead.",
      retryable: false,
    };
  }

  const check = checkNewPassword(password, confirm, { email: row.user.email, name: row.user.name });
  if (!check.ok) return { ok: false, message: check.message, retryable: true };

  const passwordHash = await bcrypt.hash(password, 12);
  try {
    await db.$transaction(async (tx) => {
      const claimed = await tx.authToken.updateMany({
        where: { id: row.id, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count === 0) throw new SisError(TOKEN_STATE_MESSAGES.used);
      // Conditional on the status too: withdrawn between page load and submit
      // means no password gets set.
      const updated = await tx.user.updateMany({
        where: { id: row.userId, status: requiredStatus, deletedAt: null },
        data: { passwordHash, status: "ACTIVE", passwordChangedAt: now },
      });
      if (updated.count === 0) throw new SisError("This account changed while you were on the page. Ask for a new link.");
      await tx.authToken.updateMany({ where: { userId: row.userId, usedAt: null, revokedAt: null }, data: { revokedAt: now } });
    });
  } catch (e) {
    if (e instanceof SisError) return { ok: false, message: e.message, retryable: false };
    throw e;
  }

  await recordAuditEvent({
    organizationId: row.organizationId,
    actorUserId: row.userId,
    action: purpose === "INVITE" ? "portal_access.invite_accepted" : "auth.password_reset_completed",
    resourceType: "user",
    resourceId: row.userId,
  });
  return { ok: true };
}
