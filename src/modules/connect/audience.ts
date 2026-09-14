import "server-only";
import { db } from "@/lib/db";
import type { MessageChannel } from "@/generated/prisma/enums";
import { addressKindFor, type Recipient } from "@/modules/connect/delivery-policy";
import type { TemplateContext } from "@/modules/connect/templates";

/**
 * Audience segmentation (blueprint 11.16 "audience segmentation"). The spec
 * is stored on the Broadcast as JSON and resolved to people at send time —
 * not at draft time — so a class that gains a student on Monday reaches the
 * new guardian when the notice goes out on Tuesday.
 */
export type AudienceSpec =
  | { kind: "all_guardians" }
  | { kind: "section_guardians"; sectionId: string }
  | { kind: "grade_guardians"; gradeId: string }
  | { kind: "all_staff" }
  | { kind: "students_with_dues" };

export const AUDIENCE_LABELS: Record<AudienceSpec["kind"], string> = {
  all_guardians: "All guardians in this branch",
  section_guardians: "Guardians of one section",
  grade_guardians: "Guardians of one grade",
  all_staff: "All staff in this branch",
  students_with_dues: "Guardians of students with unpaid fees",
};

export function parseAudience(value: unknown): AudienceSpec | null {
  if (typeof value !== "object" || value === null) return null;
  const kind = (value as { kind?: unknown }).kind;
  const sectionId = (value as { sectionId?: unknown }).sectionId;
  const gradeId = (value as { gradeId?: unknown }).gradeId;
  switch (kind) {
    case "all_guardians":
    case "all_staff":
    case "students_with_dues":
      return { kind };
    case "section_guardians":
      return typeof sectionId === "string" && sectionId ? { kind, sectionId } : null;
    case "grade_guardians":
      return typeof gradeId === "string" && gradeId ? { kind, gradeId } : null;
    default:
      return null;
  }
}

/** A resolved recipient plus the per-person data a template may use. */
export interface AudienceMember {
  recipient: Recipient;
  context: TemplateContext;
}

function guardianRecipient(
  link: {
    id: string;
    guardian: { id: string; firstName: string; lastName: string; phone: string; email: string | null; optOutSms: boolean; optOutEmail: boolean };
    student: { firstName: string; lastName: string; admissionNumber: string; currentSection: { name: string; grade: { name: string } } | null };
  },
  channel: MessageChannel,
  common: TemplateContext,
): AudienceMember {
  const g = link.guardian;
  const wantsEmail = addressKindFor(channel) === "email";
  return {
    recipient: {
      key: g.id,
      name: `${g.firstName} ${g.lastName}`.trim(),
      address: (wantsEmail ? g.email ?? "" : g.phone) ?? "",
      channel,
      optedOut: wantsEmail ? g.optOutEmail : g.optOutSms,
    },
    context: {
      ...common,
      "guardian.name": `${g.firstName} ${g.lastName}`.trim(),
      "student.first_name": link.student.firstName,
      "student.full_name": `${link.student.firstName} ${link.student.lastName}`.trim(),
      "student.admission_number": link.student.admissionNumber,
      "student.section": link.student.currentSection ? `${link.student.currentSection.grade.name} / ${link.student.currentSection.name}` : "",
    },
  };
}

const guardianLinkInclude = {
  guardian: { select: { id: true, firstName: true, lastName: true, phone: true, email: true, optOutSms: true, optOutEmail: true } },
  student: { select: { firstName: true, lastName: true, admissionNumber: true, currentSection: { select: { name: true, grade: { select: { name: true } } } } } },
} as const;

export async function resolveAudience(
  spec: AudienceSpec,
  channel: MessageChannel,
  scope: { organizationId: string; branchId: string; branchName: string; organizationName: string },
): Promise<AudienceMember[]> {
  const common: TemplateContext = {
    "school.name": scope.branchName,
    "organization.name": scope.organizationName,
    "date.today": new Date().toISOString().slice(0, 10),
  };
  const enrolledInBranch = { organizationId: scope.organizationId, branchId: scope.branchId, status: "ENROLLED" as const, deletedAt: null };

  switch (spec.kind) {
    case "all_guardians": {
      const links = await db.studentGuardian.findMany({ where: { student: enrolledInBranch }, include: guardianLinkInclude });
      return links.map((l) => guardianRecipient(l, channel, common));
    }
    case "section_guardians": {
      const links = await db.studentGuardian.findMany({
        where: { student: { ...enrolledInBranch, currentSectionId: spec.sectionId } },
        include: guardianLinkInclude,
      });
      return links.map((l) => guardianRecipient(l, channel, common));
    }
    case "grade_guardians": {
      const links = await db.studentGuardian.findMany({
        where: { student: { ...enrolledInBranch, currentSection: { gradeId: spec.gradeId } } },
        include: guardianLinkInclude,
      });
      return links.map((l) => guardianRecipient(l, channel, common));
    }
    case "students_with_dues": {
      const links = await db.studentGuardian.findMany({
        where: { student: { ...enrolledInBranch, invoices: { some: { status: { in: ["PENDING", "PARTIAL"] } } } } },
        include: guardianLinkInclude,
      });
      return links.map((l) => guardianRecipient(l, channel, common));
    }
    case "all_staff": {
      const staff = await db.staff.findMany({
        where: { organizationId: scope.organizationId, deletedAt: null, exitDate: null, OR: [{ branchId: scope.branchId }, { branchId: null }] },
        include: { user: { select: { name: true, email: true } } },
      });
      const wantsEmail = addressKindFor(channel) === "email";
      return staff.map((s) => ({
        recipient: {
          key: s.id,
          name: s.user.name,
          // Staff have no phone column yet — an SMS to staff has no address
          // and is suppressed rather than guessed at.
          address: wantsEmail ? s.user.email : "",
          channel,
          optedOut: false,
        },
        context: { ...common, "guardian.name": s.user.name },
      }));
    }
  }
}

/** Counts without building every context — for the audience picker. */
export async function estimateAudience(spec: AudienceSpec, channel: MessageChannel, scope: { organizationId: string; branchId: string; branchName: string; organizationName: string }) {
  const members = await resolveAudience(spec, channel, scope);
  return members.length;
}
