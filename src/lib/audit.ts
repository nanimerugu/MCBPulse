import "server-only";
import { db } from "@/lib/db";

export interface AuditEventInput {
  organizationId?: string | null;
  actorUserId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * The only write path onto AuditEvent. There is deliberately no update or
 * delete helper alongside this one — the log is append-only (blueprint
 * sections 5, 9, 18, 30). If a mutation needs to be audited, it calls this;
 * nothing else should touch the AuditEvent table directly.
 */
export async function recordAuditEvent(input: AuditEventInput) {
  await db.auditEvent.create({
    data: {
      organizationId: input.organizationId ?? null,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      before: toJson(input.before),
      after: toJson(input.after),
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}

function toJson(value: unknown) {
  if (value === undefined) return undefined;
  // Prisma's Json fields reject `undefined` inside the object but are fine
  // with the JSON round-trip clearing it out.
  return JSON.parse(JSON.stringify(value));
}
