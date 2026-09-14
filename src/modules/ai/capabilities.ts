import type { AiCapability } from "@/generated/prisma/enums";
import type { Action } from "@/lib/permissions";

/**
 * The capability registry: what the AI layer is allowed to do, and what each
 * thing costs in permission terms.
 *
 * Blueprint 11.18: "Every AI action is permission-aware, logged and
 * traceable to source records." A capability that reads student work must
 * require the permission that already guards student work — otherwise the AI
 * feature becomes a way around RBAC, which is the most common way these
 * layers go wrong.
 *
 * `readsSchoolData` is the flag that decides whether redaction runs and
 * whether the fence is used. Capabilities that only transform text the user
 * typed (translation, writing assistance) never touch the database at all.
 */
export interface CapabilityDef {
  key: AiCapability;
  name: string;
  description: string;
  /** The permission a caller must already hold for the underlying records. */
  requires: { module: string; action: Action };
  readsSchoolData: boolean;
  /** Shown to the user before they run it, so the trade is explicit. */
  dataNote: string;
  instruction: string;
}

export const CAPABILITIES: CapabilityDef[] = [
  {
    key: "LESSON_PLANNER",
    name: "Lesson plan",
    description: "Draft a lesson plan for a subject and grade.",
    requires: { module: "lms.courses", action: "create" },
    readsSchoolData: false,
    dataNote: "Sends only the topic and year group you type. No student data leaves the school.",
    instruction:
      "Draft a practical lesson plan. Include learning objectives, a sequence of activities with rough timings, materials needed, and two ways to check understanding. Keep it to one page.",
  },
  {
    key: "QUESTION_GENERATOR",
    name: "Question paper",
    description: "Generate practice questions for a topic.",
    requires: { module: "lms.assignments", action: "create" },
    readsSchoolData: false,
    dataNote: "Sends only the topic, question count and difficulty you choose.",
    instruction:
      "Generate practice questions on the topic. Vary the question types and mark them with the marks each carries. Provide an answer key at the end, clearly separated.",
  },
  {
    key: "WORKSHEET_GENERATOR",
    name: "Worksheet",
    description: "Build a printable worksheet on a topic.",
    requires: { module: "lms.assignments", action: "create" },
    readsSchoolData: false,
    dataNote: "Sends only the topic and year group you type.",
    instruction: "Build a worksheet suitable for printing: a short instruction line, then graded exercises from easiest to hardest.",
  },
  {
    key: "WRITING_ASSIST",
    name: "Writing help",
    description: "Improve a notice, letter or email before it goes out.",
    requires: { module: "connect.broadcasts", action: "create" },
    readsSchoolData: false,
    dataNote: "Sends the text you paste. Remove parent or student names first — the gateway also redacts what it recognises.",
    instruction: "Improve the clarity and tone of the text for a school audience. Keep it short and plain. Do not invent facts, dates or figures that are not in the original.",
  },
  {
    key: "TRANSLATION",
    name: "Translate",
    description: "Translate a school notice into another language.",
    requires: { module: "connect.broadcasts", action: "create" },
    readsSchoolData: false,
    dataNote: "Sends the text you paste.",
    instruction: "Translate the text faithfully into the requested language. Keep names, dates and figures exactly as they appear. Return only the translation.",
  },
  {
    key: "GRADING_ASSIST",
    name: "Grading assistance",
    description: "Suggest feedback on a piece of submitted work.",
    requires: { module: "lms.grades", action: "edit" },
    readsSchoolData: true,
    dataNote: "Reads the submission you choose. Student names are redacted before anything is sent.",
    instruction:
      "Suggest constructive feedback on the work, and a mark out of the maximum given, with a one-line justification. This is a FIRST PASS for a teacher to accept, change or reject — say so at the end.",
  },
  {
    key: "SCHOOL_COPILOT",
    name: "Ask about the school",
    description: "Answer a question from the school's own figures.",
    requires: { module: "audit.events", action: "view" },
    readsSchoolData: true,
    dataNote: "Reads summary counts only — never individual student records.",
    instruction: "Answer the question using only the figures provided. If the figures do not contain the answer, say so plainly rather than estimating.",
  },
];

export const CAPABILITY_BY_KEY = new Map(CAPABILITIES.map((c) => [c.key, c]));

export function capabilityFor(key: string): CapabilityDef | null {
  return CAPABILITY_BY_KEY.get(key as AiCapability) ?? null;
}

/**
 * Capabilities the blueprint names that are NOT registered, and why. Shown in
 * the UI so the gap is visible rather than looking like an oversight.
 */
export const UNBUILT_CAPABILITIES: { name: string; reason: string }[] = [
  { name: "Document extraction", reason: "Needs the Files adapter — there is nowhere to upload a document to yet." },
  { name: "YouTube summarisation", reason: "Needs outbound fetching and a transcript source; neither is built." },
  { name: "Predictive insight", reason: "Predicting a child's outcome is a decision with consequences; it needs a policy and an accuracy claim nobody here can make yet." },
];
