import { notFound } from "next/navigation";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { resolvePublicBranch } from "@/modules/admissions/public-intake";
import { db } from "@/lib/db";
import { submitEnquiryAction } from "@/app/apply/[orgSlug]/[branchCode]/actions";

/**
 * The public admission enquiry page (blueprint 10.5 "lead enters via website
 * form"). No login. Tenant comes from the URL; everything else is validated,
 * honeypotted and rate-limited in the action.
 */
export default async function PublicApplyPage({ params }: { params: Promise<{ orgSlug: string; branchCode: string }> }) {
  const { orgSlug, branchCode } = await params;
  const target = await resolvePublicBranch(orgSlug, branchCode);
  if (!target) notFound();

  const grades = await db.grade.findMany({ where: { branchId: target.branch.id, deletedAt: null }, orderBy: { sequence: "asc" }, select: { name: true } });

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-10 dark:bg-zinc-950">
      <div className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{target.organization.name}</p>
        <h1 className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Admission enquiry — {target.branch.name}</h1>
        <p className="mt-1 mb-6 text-sm text-zinc-500 dark:text-zinc-400">Tell us a little about your child and we&apos;ll call you back.</p>

        <ActionForm action={submitEnquiryAction.bind(null, orgSlug, branchCode)} hidden={{}} submitLabel="Send enquiry" pendingLabel="Sending…" variant="primary">
          <Field label="Your name" htmlFor="pe-name">
            <Input id="pe-name" name="name" required autoComplete="name" />
          </Field>
          <Field label="Phone" htmlFor="pe-phone">
            <Input id="pe-phone" name="phone" type="tel" required autoComplete="tel" />
          </Field>
          <Field label="Email (optional)" htmlFor="pe-email">
            <Input id="pe-email" name="email" type="email" autoComplete="email" />
          </Field>
          <Field label="Grade you're interested in" htmlFor="pe-grade">
            <Select id="pe-grade" name="gradeInterest" defaultValue="">
              <option value="">Not sure yet</option>
              {grades.map((g) => (
                <option key={g.name} value={g.name}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Anything you'd like us to know (optional)" htmlFor="pe-message">
            <Textarea id="pe-message" name="message" rows={3} />
          </Field>
          {/* Honeypot: hidden from people, irresistible to bots. */}
          <div aria-hidden="true" className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden">
            <label htmlFor="pe-website">Website</label>
            <input id="pe-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
          </div>
        </ActionForm>
      </div>
    </div>
  );
}
