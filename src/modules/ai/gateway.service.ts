import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { resolveAccess } from "@/lib/rbac";
import type { AiCapability } from "@/generated/prisma/enums";
import { capabilityFor, type CapabilityDef } from "@/modules/ai/capabilities";
import { buildPrompt, looksLikeInjection } from "@/modules/ai/prompt";
import { getAiProvider } from "@/modules/ai/providers";
import { redact, restore, totalRedactions } from "@/modules/ai/redaction";
import { SisError, type Actor } from "@/modules/sis/students.service";

/**
 * The AI Gateway. One door, and everything goes through it:
 *
 *   permission → redact → fence → provider → account → audit
 *
 * Nothing else in the codebase may call a provider directly. That is the
 * whole point of a gateway: the safety steps cannot be skipped by a caller
 * who forgets them, because there is no other path.
 *
 * Note what the gateway deliberately CANNOT do: it returns text. No
 * capability writes to the database, marks a register, sends a message or
 * changes a grade. A model that can only produce a draft for a human to
 * accept has a bounded blast radius, and that bound is worth more than any
 * amount of prompt engineering.
 */

export interface GatewayScope {
  organizationId: string;
  branchId: string;
}

export interface GatewayRequest {
  capability: AiCapability;
  /** What the user typed. */
  task: string;
  /** Records the capability chose to read. Fenced as untrusted. */
  schoolData?: string;
  /** Names to redact — the people in scope for this request, not the roster. */
  knownNames?: string[];
}

export interface GatewayResult {
  generationId: string;
  text: string;
  generated: boolean;
  redactions: number;
  injectionSuspected: boolean;
  tokensIn: number;
  tokensOut: number;
  provider: string;
  model: string;
}

const MAX_TASK_CHARS = 8000;

export async function runCapability(request: GatewayRequest, scope: GatewayScope, actor: Actor): Promise<GatewayResult> {
  const capability = capabilityFor(request.capability);
  if (!capability) throw new SisError("That AI capability is not available");
  if (request.task.trim().length === 0) throw new SisError("Say what you want help with");
  if (request.task.length > MAX_TASK_CHARS) throw new SisError(`That's too long — keep it under ${MAX_TASK_CHARS} characters`);

  // 1. Permission. The capability requires the permission that already
  //    guards the underlying records, so AI can never be a way around RBAC.
  const decision = await resolveAccess(actor.userId, capability.requires.module, capability.requires.action, {
    organizationId: scope.organizationId,
    branchId: scope.branchId,
  });
  if (!decision.allowed) {
    throw new SisError(`This needs ${capability.requires.module}:${capability.requires.action}, which you don't hold`);
  }
  // A self-scoped viewer (parent/student) must not reach staff capabilities.
  if (decision.selfScoped) throw new SisError("This is not available from a parent or student account");

  // 2. Redact before anything leaves. Runs on the user's text too, not just
  //    on retrieved records — a teacher pasting a parent's complaint is the
  //    likeliest way a name reaches a provider.
  const names = request.knownNames ?? [];
  const redactedTask = redact(request.task, names);
  const redactedData = request.schoolData ? redact(request.schoolData, names) : null;
  const redactions = totalRedactions(redactedTask.counts) + (redactedData ? totalRedactions(redactedData.counts) : 0);

  const injectionSuspected = looksLikeInjection(request.task) || (request.schoolData ? looksLikeInjection(request.schoolData) : false);

  // 3. Fence. School data is data; the system prompt says so explicitly.
  const prompt = buildPrompt({
    instruction: capability.instruction,
    task: redactedTask.text,
    schoolData: redactedData?.text,
  });

  const provider = getAiProvider();

  const generation = await db.aiGeneration.create({
    data: {
      organizationId: scope.organizationId,
      userId: actor.userId,
      capability: capability.key,
      status: "PENDING",
      // The REDACTED text, not the raw. Redaction protects the provider from
      // seeing identifiers; storing the raw text here would just move the
      // exposure into our own database and then show it, on the usage page,
      // to every colleague holding ai.usage:view. The log needs to say what
      // was asked for, not reproduce what was pasted.
      inputSummary: summarize(redactedTask.text),
    },
  });

  try {
    const completion = await provider.complete(prompt);

    // 4. Account. Recorded per generation whether or not a model ran, so the
    //    cost of switching a provider on is knowable in advance.
    await db.aiUsageRecord.create({
      data: {
        generationId: generation.id,
        provider: provider.name,
        model: provider.model,
        tokensIn: completion.tokensIn,
        tokensOut: completion.tokensOut,
        costUsd: completion.costUsd === null ? null : completion.costUsd.toFixed(6),
      },
    });

    // Put the real names back for the human reading it. The provider never
    // saw them; the teacher needs them.
    const text = restore(restore(completion.text, redactedTask.map), redactedData?.map ?? new Map());

    await db.aiGeneration.update({
      where: { id: generation.id },
      data: { status: "COMPLETED", outputSummary: summarize(text) },
    });

    // 5. Audit. Summaries only — the audit log is not the place to keep a
    //    second copy of whatever someone pasted in.
    await recordAuditEvent({
      organizationId: scope.organizationId,
      actorUserId: actor.userId,
      action: "ai.generation",
      resourceType: "ai_generation",
      resourceId: generation.id,
      after: {
        capability: capability.key,
        provider: provider.name,
        generated: completion.generated,
        redactions,
        injectionSuspected,
        tokensIn: completion.tokensIn,
        tokensOut: completion.tokensOut,
      },
    });

    return {
      generationId: generation.id,
      text,
      generated: completion.generated,
      redactions,
      injectionSuspected,
      tokensIn: completion.tokensIn,
      tokensOut: completion.tokensOut,
      provider: provider.name,
      model: provider.model,
    };
  } catch (e) {
    await db.aiGeneration.update({ where: { id: generation.id }, data: { status: "FAILED", outputSummary: e instanceof Error ? e.message : "Unknown error" } });
    throw e;
  }
}

function summarize(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= 160 ? clean : `${clean.slice(0, 157)}…`;
}

export async function listGenerations(organizationId: string, take = 50) {
  return db.aiGeneration.findMany({
    where: { organizationId },
    include: { user: { select: { name: true } }, usageRecords: true },
    orderBy: { createdAt: "desc" },
    take,
  });
}

/** Usage rolled up by capability — what the school is actually using this for. */
export async function usageByCapability(organizationId: string) {
  const generations = await db.aiGeneration.findMany({
    where: { organizationId },
    select: { capability: true, status: true, usageRecords: { select: { tokensIn: true, tokensOut: true } } },
  });
  const rows = new Map<AiCapability, { runs: number; failed: number; tokensIn: number; tokensOut: number }>();
  for (const g of generations) {
    const row = rows.get(g.capability) ?? { runs: 0, failed: 0, tokensIn: 0, tokensOut: 0 };
    row.runs += 1;
    if (g.status === "FAILED") row.failed += 1;
    for (const u of g.usageRecords) {
      row.tokensIn += u.tokensIn;
      row.tokensOut += u.tokensOut;
    }
    rows.set(g.capability, row);
  }
  return [...rows.entries()].map(([capability, v]) => ({ capability, ...v })).sort((a, b) => b.runs - a.runs);
}

/**
 * Summary counts for the copilot — deliberately aggregates only. The copilot
 * answers "how many students are enrolled", never "tell me about Priya", and
 * the way to guarantee that is to give it nothing else.
 */
export async function copilotFigures(scope: GatewayScope): Promise<string> {
  const [students, staff, sections, outstanding, absentToday, onLoan] = await Promise.all([
    db.student.count({ where: { organizationId: scope.organizationId, deletedAt: null, status: "ENROLLED" } }),
    db.staff.count({ where: { organizationId: scope.organizationId, branchId: scope.branchId, deletedAt: null, exitDate: null } }),
    db.section.count({ where: { grade: { branchId: scope.branchId } } }),
    db.invoice.count({ where: { student: { organizationId: scope.organizationId }, status: { in: ["PENDING", "PARTIAL"] } } }),
    db.attendanceRecord.count({
      where: { status: "ABSENT", student: { organizationId: scope.organizationId }, session: { date: { gte: new Date(Date.now() - 86_400_000) } } },
    }),
    db.libraryIssue.count({ where: { returnedAt: null, libraryItem: { branchId: scope.branchId } } }),
  ]);
  return [
    `enrolled students: ${students}`,
    `active staff: ${staff}`,
    `sections: ${sections}`,
    `invoices not fully paid: ${outstanding}`,
    `absences recorded in the last day: ${absentToday}`,
    `library books on loan: ${onLoan}`,
  ].join("\n");
}

export type { CapabilityDef };
