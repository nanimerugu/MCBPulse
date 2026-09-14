"use server";

import { headers } from "next/headers";
import { fieldErrors } from "@/modules/sis/schemas";
import { publicEnquirySchema } from "@/modules/admissions/schemas";
import { submitPublicEnquiry } from "@/modules/admissions/public-intake";
import type { FormState } from "@/modules/sis/form-state";

export async function submitEnquiryAction(orgSlug: string, branchCode: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const values: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") values[k] = v;
  const parsed = publicEnquirySchema.safeParse(values);
  if (!parsed.success) {
    const fe = fieldErrors(parsed.error);
    // A filled honeypot fails validation; pretend it worked so the bot learns nothing.
    if (fe.website) return { success: "Thank you — we'll be in touch shortly." };
    return { fieldErrors: fe };
  }

  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();

  const result = await submitPublicEnquiry(orgSlug, branchCode, parsed.data, ip);
  if (result.ok || result.reason === "bot") return { success: "Thank you — we'll be in touch shortly." };
  if (result.reason === "rate_limited") return { error: "Too many enquiries from this connection. Please try again in a few minutes." };
  return { error: "This enquiry form isn't available right now." };
}
