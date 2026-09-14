"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ForbiddenError } from "@/lib/rbac";
import { withBranch } from "@/lib/branch-context";
import { actorOf, requireExamsAccessForAction, str, type ModuleAccess } from "@/modules/sis/access";
import type { FormState } from "@/modules/sis/form-state";
import { fieldErrors } from "@/modules/sis/schemas";
import { SisError } from "@/modules/sis/students.service";
import { DIFFICULTIES, QUESTION_TYPES, type BlueprintLine } from "@/modules/examcell/paper";
import {
  addQuestion,
  createBank,
  createExam,
  generateExamPaper,
  gradeAnswers,
  publishExam,
  retireQuestion,
  submitAttempt,
  type ExamScope,
} from "@/modules/examcell/examcell.service";

function toFormState(error: unknown): FormState {
  if (error instanceof SisError || error instanceof ForbiddenError) return { error: error.message };
  throw error;
}
function values(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") out[k] = v;
  return out;
}
function scopeOf(access: ModuleAccess): ExamScope {
  return { organizationId: access.ctx.organizationId, branchId: access.ctx.branch.id };
}
const optional = (s: z.ZodTypeAny) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), s.optional());
const typeEnum = z.enum(QUESTION_TYPES as [string, ...string[]]);
const difficultyEnum = z.enum(DIFFICULTIES as [string, ...string[]]);

export async function createBankAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireExamsAccessForAction(str(formData, "branchId"), "exams.banks", "create");
    const parsed = z.object({ subjectId: z.string().min(1, "Choose a subject"), name: z.string().trim().min(1, "Name is required").max(80) }).safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await createBank(parsed.data, scopeOf(access), actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/exams/banks");
  return { success: "Question bank created" };
}

export async function addQuestionAction(bankId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireExamsAccessForAction(str(formData, "branchId"), "exams.banks", "create");
    const parsed = z
      .object({
        type: typeEnum,
        text: z.string().trim().min(1, "Write the question").max(2000),
        marks: z.coerce.number().int().min(1, "At least one mark").max(100),
        difficulty: difficultyEnum,
        correctAnswer: optional(z.string().trim().max(1000)),
        explanation: optional(z.string().trim().max(1000)),
        correctIndex: optional(z.coerce.number().int().min(0).max(5)),
      })
      .safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

    // Options arrive as option0..option5; blanks are dropped so a teacher can
    // write a 3-option question without deleting empty boxes.
    const texts = [0, 1, 2, 3, 4, 5].map((i) => str(formData, `option${i}`)?.trim() ?? "").filter((t) => t.length > 0);
    const correctIndex = (parsed.data.correctIndex as number | undefined) ?? 0;
    const options = texts.map((text, i) => ({ text, isCorrect: i === correctIndex }));

    await addQuestion(
      bankId,
      {
        type: parsed.data.type as (typeof QUESTION_TYPES)[number],
        text: parsed.data.text,
        marks: parsed.data.marks,
        difficulty: parsed.data.difficulty as (typeof DIFFICULTIES)[number],
        options,
        correctAnswer: parsed.data.correctAnswer as string | undefined,
        explanation: parsed.data.explanation as string | undefined,
      },
      scopeOf(access),
      actorOf(access),
    );
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/exams/banks/${bankId}`);
  return { success: "Question added" };
}

export async function retireQuestionAction(bankId: string, questionId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireExamsAccessForAction(str(formData, "branchId"), "exams.banks", "edit");
    await retireQuestion(questionId, scopeOf(access), actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/exams/banks/${bankId}`);
  return { success: "Question retired" };
}

export async function createExamAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let examId: string;
  let ctx: { branch: { id: string }; branches: unknown[] };
  try {
    const access = await requireExamsAccessForAction(str(formData, "branchId"), "exams.exams", "create");
    const parsed = z
      .object({
        sectionId: z.string().min(1, "Choose a section"),
        subjectId: z.string().min(1, "Choose a subject"),
        title: z.string().trim().min(1, "Title is required").max(120),
        scheduledAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Pick a date and time"),
        durationMinutes: z.coerce.number().int().min(5, "At least 5 minutes").max(480),
        maxMarks: z.coerce.number().int().min(1).max(1000),
        instructions: optional(z.string().trim().max(1000)),
      })
      .safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

    const exam = await createExam(
      {
        sectionId: parsed.data.sectionId,
        subjectId: parsed.data.subjectId,
        title: parsed.data.title,
        scheduledAt: new Date(`${parsed.data.scheduledAt}:00.000Z`),
        durationMinutes: parsed.data.durationMinutes,
        maxMarks: parsed.data.maxMarks,
        instructions: parsed.data.instructions as string | undefined,
      },
      scopeOf(access),
      actorOf(access),
    );
    examId = exam.id;
    ctx = access.ctx;
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/exams");
  redirect(withBranch(`/exams/${examId}`, ctx as never));
}

export async function generatePaperAction(examId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireExamsAccessForAction(str(formData, "branchId"), "exams.exams", "create");
    const bankId = str(formData, "bankId");
    if (!bankId) return { error: "Choose a question bank" };

    // One blueprint line per (type, difficulty) box the teacher filled in.
    const blueprint: BlueprintLine[] = [];
    for (const type of QUESTION_TYPES) {
      for (const difficulty of DIFFICULTIES) {
        const raw = str(formData, `n_${type}_${difficulty}`);
        const count = raw ? Number(raw) : 0;
        if (Number.isInteger(count) && count > 0) blueprint.push({ type, difficulty, count });
      }
    }
    if (blueprint.length === 0) return { error: "Ask for at least one question" };

    const seedRaw = str(formData, "seed");
    const seed = seedRaw && /^\d+$/.test(seedRaw) ? Number(seedRaw) : Date.now() % 100000;

    const outcome = await generateExamPaper(examId, { bankId, blueprint, seed }, scopeOf(access), actorOf(access));
    revalidatePath(`/exams/${examId}`);
    return { success: `Paper built — ${outcome.questions} questions, ${outcome.totalMarks} marks (seed ${seed})` };
  } catch (e) {
    return toFormState(e);
  }
}

export async function publishExamAction(examId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireExamsAccessForAction(str(formData, "branchId"), "exams.exams", "publish");
    const outcome = await publishExam(examId, scopeOf(access), actorOf(access));
    revalidatePath(`/exams/${examId}`);
    revalidatePath("/exams");
    return { success: `Published — ${outcome.attempts} student${outcome.attempts === 1 ? "" : "s"} to sit it` };
  } catch (e) {
    return toFormState(e);
  }
}

/** Enter a paper sat on paper: one form carrying every answer. */
export async function recordAttemptAction(attemptId: string, examId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireExamsAccessForAction(str(formData, "branchId"), "exams.exams", "edit");
    const answers: { paperQuestionId: string; selectedOptionId?: string; responseText?: string }[] = [];
    for (const [key, value] of formData.entries()) {
      if (typeof value !== "string") continue;
      if (key.startsWith("opt_")) answers.push({ paperQuestionId: key.slice(4), selectedOptionId: value || undefined });
      else if (key.startsWith("txt_")) answers.push({ paperQuestionId: key.slice(4), responseText: value || undefined });
    }
    if (answers.length === 0) return { error: "Nothing was answered" };

    const totals = await submitAttempt(attemptId, answers, scopeOf(access), actorOf(access));
    revalidatePath(`/exams/${examId}`);
    revalidatePath(`/exams/attempts/${attemptId}`);
    return {
      success:
        totals.awaitingTeacher === 0
          ? `Marked automatically — ${totals.awarded}/${totals.possible}`
          : `${totals.autoGradedCount} auto-marked, ${totals.awaitingTeacher} awaiting you`,
    };
  } catch (e) {
    return toFormState(e);
  }
}

export async function gradeAttemptAction(attemptId: string, examId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireExamsAccessForAction(str(formData, "branchId"), "exams.exams", "edit");
    const marks: { answerId: string; marksAwarded: number; feedback?: string }[] = [];
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("mark_") || typeof value !== "string" || value.trim() === "") continue;
      const answerId = key.slice(5);
      const n = Number(value);
      if (!Number.isFinite(n)) return { error: "Marks must be numbers" };
      marks.push({ answerId, marksAwarded: n, feedback: str(formData, `fb_${answerId}`) || undefined });
    }
    if (marks.length === 0) return { error: "No marks entered" };

    await gradeAnswers(attemptId, marks, scopeOf(access), actorOf(access));
    revalidatePath(`/exams/attempts/${attemptId}`);
    revalidatePath(`/exams/${examId}`);
    return { success: "Marks saved" };
  } catch (e) {
    return toFormState(e);
  }
}
