import { z } from "zod";
import { parseMoneyInput } from "@/modules/finance/money";

const optionalText = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().trim().max(500).optional(),
);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use yyyy-mm-dd");

/** A typed amount, validated and converted to minor units. */
const money = z
  .string()
  .transform((s, ctx) => {
    const minor = parseMoneyInput(s);
    if (minor === null) {
      ctx.addIssue({ code: "custom", message: "Enter an amount like 1250 or 1250.50" });
      return z.NEVER;
    }
    return minor;
  })
  .pipe(z.number().int().min(1, "Amount must be more than zero"));

export const feeHeadSchema = z.object({ name: z.string().trim().min(1, "Name is required").max(80) });

export const feeStructureSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  gradeId: optionalText,
});

export const feeStructureLineSchema = z.object({
  feeHeadId: z.string().min(1, "Choose a fee head"),
  amount: money,
});

export const concessionSchema = z.object({
  amount: money,
  reason: z.string().trim().min(1, "Reason is required").max(300),
  feeStructureId: optionalText,
});

export const raiseInvoiceSchema = z.object({
  feeStructureId: z.string().min(1, "Choose a fee structure"),
  dueDate: isoDate,
});

export const raiseForSectionSchema = raiseInvoiceSchema.extend({
  sectionId: z.string().min(1, "Choose a section"),
});

export const paymentSchema = z.object({
  amount: money,
  method: z.enum(["CASH", "CHEQUE", "BANK_TRANSFER", "ONLINE"]),
  paidAt: isoDate,
  reference: optionalText,
});

export const refundRequestSchema = z.object({
  amount: money,
  reason: z.string().trim().min(1, "Reason is required").max(300),
});
