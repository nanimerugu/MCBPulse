import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import type { MessageChannel } from "@/generated/prisma/enums";
import { unknownVariables } from "@/modules/connect/templates";
import { SisError, type Actor } from "@/modules/sis/students.service";

export async function listTemplates(organizationId: string) {
  return db.messageTemplate.findMany({
    where: { organizationId, deletedAt: null },
    include: { _count: { select: { broadcasts: true } } },
    orderBy: { name: "asc" },
  });
}

export async function getTemplate(templateId: string, organizationId: string) {
  return db.messageTemplate.findFirst({ where: { id: templateId, organizationId, deletedAt: null } });
}

/**
 * A template is rejected at save time if it uses a variable outside the
 * allow-list. Catching it here rather than at send time is the point: the
 * author sees the mistake while writing, and a template that could leak
 * arbitrary data never reaches the database.
 */
export async function createTemplate(input: { name: string; channel: MessageChannel; body: string }, actor: Actor) {
  const unknown = unknownVariables(input.body);
  if (unknown.length > 0) throw new SisError(`Unknown template variable(s): ${unknown.join(", ")}. Use only the listed variables.`);

  const template = await db.messageTemplate.create({
    data: { organizationId: actor.organizationId, name: input.name, channel: input.channel, body: input.body },
  });
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "message_template.created",
    resourceType: "message_template",
    resourceId: template.id,
    after: { name: input.name, channel: input.channel },
  });
  return template;
}

export async function updateTemplate(templateId: string, input: { name: string; body: string }, actor: Actor) {
  const existing = await getTemplate(templateId, actor.organizationId);
  if (!existing) throw new SisError("Template not found");
  const unknown = unknownVariables(input.body);
  if (unknown.length > 0) throw new SisError(`Unknown template variable(s): ${unknown.join(", ")}`);

  await db.messageTemplate.update({ where: { id: templateId }, data: { name: input.name, body: input.body } });
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "message_template.updated",
    resourceType: "message_template",
    resourceId: templateId,
    before: { name: existing.name, body: existing.body },
    after: { name: input.name, body: input.body },
  });
}
