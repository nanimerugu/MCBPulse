import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import type { Prisma } from "@/generated/prisma/client";
import type { AdmissionCampaignChannel, LeadStage } from "@/generated/prisma/enums";
import { LEAD_STAGE_ORDER, canMoveLead, isPlausiblePhone, normalizePhone } from "@/modules/admissions/pipeline";
import type { LeadInput } from "@/modules/admissions/schemas";
import { SisError, type Actor } from "@/modules/sis/students.service";

export const LEAD_PAGE_SIZE = 50;

export interface LeadListQuery {
  organizationId: string;
  branchId: string;
  q?: string;
  stage?: LeadStage;
  counselorUserId?: string;
  page?: number;
}

export async function listLeads(query: LeadListQuery) {
  const page = Math.max(1, query.page ?? 1);
  const q = query.q?.trim();
  const digits = q ? normalizePhone(q) : "";

  const where: Prisma.LeadWhereInput = {
    organizationId: query.organizationId,
    branchId: query.branchId,
    deletedAt: null,
    ...(query.stage ? { stage: query.stage } : {}),
    ...(query.counselorUserId ? { assignedCounselorUserId: query.counselorUserId } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []),
          ],
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    db.lead.count({ where }),
    db.lead.findMany({
      where,
      include: { source: true, campaign: true, applications: { select: { id: true, status: true } } },
      orderBy: [{ nextFollowUpAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      skip: (page - 1) * LEAD_PAGE_SIZE,
      take: LEAD_PAGE_SIZE,
    }),
  ]);

  const counselorIds = [...new Set(items.map((l) => l.assignedCounselorUserId).filter((id): id is string => !!id))];
  const counselors = counselorIds.length
    ? await db.user.findMany({ where: { id: { in: counselorIds } }, select: { id: true, name: true } })
    : [];
  const counselorName = new Map(counselors.map((u) => [u.id, u.name]));

  return {
    items: items.map((l) => ({ ...l, counselorName: l.assignedCounselorUserId ? counselorName.get(l.assignedCounselorUserId) ?? "—" : null })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / LEAD_PAGE_SIZE)),
  };
}

/** Lead counts per stage for the funnel header. */
export async function funnelCounts(organizationId: string, branchId: string): Promise<Record<LeadStage, number>> {
  const rows = await db.lead.groupBy({
    by: ["stage"],
    where: { organizationId, branchId, deletedAt: null },
    _count: { _all: true },
  });
  const out = Object.fromEntries(LEAD_STAGE_ORDER.map((s) => [s, 0])) as Record<LeadStage, number>;
  for (const r of rows) out[r.stage] = r._count._all;
  return out;
}

export async function getLead(leadId: string, organizationId: string) {
  const lead = await db.lead.findFirst({
    where: { id: leadId, organizationId, deletedAt: null },
    include: {
      source: true,
      campaign: true,
      branch: true,
      applications: {
        include: {
          documents: { orderBy: { createdAt: "asc" } },
          appointments: { orderBy: { scheduledAt: "asc" } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!lead) return null;

  const [counselor, timeline] = await Promise.all([
    lead.assignedCounselorUserId ? db.user.findUnique({ where: { id: lead.assignedCounselorUserId }, select: { id: true, name: true } }) : null,
    db.auditEvent.findMany({
      where: { organizationId, resourceType: "lead", resourceId: leadId },
      include: { actorUser: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  return { lead, counselor, timeline };
}

/** Same phone (normalized), same org, still in play. */
export async function findDuplicateLead(organizationId: string, phone: string) {
  const digits = normalizePhone(phone);
  if (!isPlausiblePhone(digits)) return null;
  return db.lead.findFirst({
    where: { organizationId, deletedAt: null, phone: digits, stage: { notIn: ["LOST"] } },
    select: { id: true, name: true, stage: true, branchId: true },
  });
}

export interface CreateLeadOptions {
  branchId: string;
  /** null for the public form. */
  actorUserId: string | null;
  organizationId: string;
  sourceId?: string | null;
  campaignId?: string | null;
  viaPublicForm?: boolean;
}

export async function createLead(input: LeadInput, opts: CreateLeadOptions) {
  const phone = normalizePhone(input.phone);
  if (!isPlausiblePhone(phone)) throw new SisError("That phone number doesn't look right");

  const dup = await findDuplicateLead(opts.organizationId, phone);
  if (dup) throw new DuplicateLeadError(dup);

  const lead = await db.lead.create({
    data: {
      organizationId: opts.organizationId,
      branchId: opts.branchId,
      sourceId: opts.sourceId ?? input.sourceId ?? null,
      campaignId: opts.campaignId ?? input.campaignId ?? null,
      name: input.name,
      phone,
      email: input.email ?? null,
    },
  });

  await recordAuditEvent({
    organizationId: opts.organizationId,
    actorUserId: opts.actorUserId,
    action: opts.viaPublicForm ? "lead.enquired_online" : "lead.created",
    resourceType: "lead",
    resourceId: lead.id,
    after: { name: lead.name, phone: lead.phone, ...(input.note ? { note: input.note } : {}) },
  });

  return lead;
}

export class DuplicateLeadError extends SisError {
  constructor(public readonly existing: { id: string; name: string; stage: LeadStage; branchId: string | null }) {
    super(`A lead with this phone already exists: ${existing.name} (${existing.stage.toLowerCase()})`);
    this.name = "DuplicateLeadError";
  }
}

export async function moveLeadStage(leadId: string, to: LeadStage, note: string | undefined, actor: Actor) {
  const lead = await db.lead.findFirst({ where: { id: leadId, organizationId: actor.organizationId, deletedAt: null } });
  if (!lead) throw new SisError("Lead not found");
  if (!canMoveLead(lead.stage, to)) throw new SisError(`A ${lead.stage.toLowerCase()} lead can't be moved to ${to.toLowerCase()}`);

  const updated = await db.lead.update({ where: { id: leadId }, data: { stage: to } });
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "lead.stage_changed",
    resourceType: "lead",
    resourceId: leadId,
    before: { stage: lead.stage },
    after: { stage: to, ...(note ? { note } : {}) },
  });
  return updated;
}

export async function assignCounselor(leadId: string, counselorUserId: string | null, actor: Actor) {
  const lead = await db.lead.findFirst({ where: { id: leadId, organizationId: actor.organizationId, deletedAt: null } });
  if (!lead) throw new SisError("Lead not found");

  let name: string | null = null;
  if (counselorUserId) {
    const ok = await db.roleAssignment.findFirst({
      where: { userId: counselorUserId, organizationId: actor.organizationId, revokedAt: null, OR: [{ branchId: null }, { branchId: lead.branchId ?? undefined }] },
      include: { user: { select: { name: true } } },
    });
    if (!ok) throw new SisError("That person has no role in this branch");
    name = ok.user.name;
  }

  await db.lead.update({ where: { id: leadId }, data: { assignedCounselorUserId: counselorUserId } });
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: counselorUserId ? "lead.assigned" : "lead.unassigned",
    resourceType: "lead",
    resourceId: leadId,
    after: { counselorUserId, counselor: name },
  });
}

export async function addLeadNote(leadId: string, note: string, actor: Actor) {
  const lead = await db.lead.findFirst({ where: { id: leadId, organizationId: actor.organizationId, deletedAt: null } });
  if (!lead) throw new SisError("Lead not found");
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "lead.note",
    resourceType: "lead",
    resourceId: leadId,
    after: { note },
  });
}

export async function setFollowUp(leadId: string, dateISO: string | undefined, actor: Actor) {
  const lead = await db.lead.findFirst({ where: { id: leadId, organizationId: actor.organizationId, deletedAt: null } });
  if (!lead) throw new SisError("Lead not found");
  const next = dateISO ? new Date(`${dateISO}T00:00:00.000Z`) : null;
  await db.lead.update({ where: { id: leadId }, data: { nextFollowUpAt: next } });
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "lead.follow_up_set",
    resourceType: "lead",
    resourceId: leadId,
    before: { nextFollowUpAt: lead.nextFollowUpAt?.toISOString().slice(0, 10) ?? null },
    after: { nextFollowUpAt: dateISO ?? null },
  });
}

/** People who can own a lead in this branch: anyone holding an admissions-capable role here. */
export async function listCounselors(organizationId: string, branchId: string) {
  const rows = await db.roleAssignment.findMany({
    where: {
      organizationId,
      revokedAt: null,
      OR: [{ branchId: null }, { branchId }],
      role: { key: { in: ["counselor", "admin_front_office", "principal", "vice_principal", "organization_admin"] } },
      user: { status: "ACTIVE", deletedAt: null },
    },
    include: { user: { select: { id: true, name: true, email: true } }, role: { select: { name: true } } },
  });
  const seen = new Map<string, { id: string; name: string; role: string }>();
  for (const r of rows) if (!seen.has(r.user.id)) seen.set(r.user.id, { id: r.user.id, name: r.user.name, role: r.role.name });
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Leads assigned to this user with a follow-up on or before today. */
export async function dueFollowUps(organizationId: string, branchId: string, userId: string) {
  const today = new Date(new Date().toISOString().slice(0, 10) + "T23:59:59.999Z");
  return db.lead.findMany({
    where: { organizationId, branchId, deletedAt: null, assignedCounselorUserId: userId, nextFollowUpAt: { lte: today }, stage: { notIn: ["ADMITTED", "LOST"] } },
    orderBy: { nextFollowUpAt: "asc" },
    take: 20,
  });
}

// --- Settings: sources & campaigns ----------------------------------------------

export async function listSources(organizationId: string) {
  return db.leadSource.findMany({ where: { organizationId, deletedAt: null }, include: { _count: { select: { leads: true } } }, orderBy: { name: "asc" } });
}

export async function findOrCreateSource(organizationId: string, name: string) {
  return db.leadSource.upsert({
    where: { organizationId_name: { organizationId, name } },
    create: { organizationId, name },
    update: {},
  });
}

export async function createSource(name: string, actor: Actor) {
  const clash = await db.leadSource.findUnique({ where: { organizationId_name: { organizationId: actor.organizationId, name } } });
  if (clash) throw new SisError(`Source "${name}" already exists`);
  const source = await db.leadSource.create({ data: { organizationId: actor.organizationId, name } });
  await recordAuditEvent({ organizationId: actor.organizationId, actorUserId: actor.userId, action: "lead_source.created", resourceType: "lead_source", resourceId: source.id, after: { name } });
  return source;
}

export async function listCampaigns(organizationId: string) {
  return db.admissionCampaign.findMany({ where: { organizationId, deletedAt: null }, include: { _count: { select: { leads: true } } }, orderBy: { startDate: "desc" } });
}

export async function createCampaign(
  input: { name: string; channel: AdmissionCampaignChannel; startDate: string; endDate?: string },
  actor: Actor,
) {
  const campaign = await db.admissionCampaign.create({
    data: {
      organizationId: actor.organizationId,
      name: input.name,
      channel: input.channel,
      startDate: new Date(`${input.startDate}T00:00:00.000Z`),
      endDate: input.endDate ? new Date(`${input.endDate}T00:00:00.000Z`) : null,
    },
  });
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "admission_campaign.created",
    resourceType: "admission_campaign",
    resourceId: campaign.id,
    after: { name: input.name, channel: input.channel, startDate: input.startDate, endDate: input.endDate ?? null },
  });
  return campaign;
}
