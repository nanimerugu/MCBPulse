import Link from "next/link";
import { authorize } from "@/lib/rbac";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadSisAccess, param } from "@/modules/sis/access";
import { listStructure } from "@/modules/sis/structure.service";
import { createGradeAction, createSectionAction } from "@/app/(app)/settings/academic-structure/actions";
import { GradeForm, SectionForm } from "@/app/(app)/settings/academic-structure/structure-forms";

export default async function AcademicStructurePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadSisAccess(param(sp, "branch"), "academics.structure", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Academic structure" />
        <AccessDenied result={result} permission="academics.structure:view" />
      </>
    );
  }
  const { viewer, ctx } = result.access;

  const [grades, canConfigure] = await Promise.all([
    listStructure(ctx.branch.id, ctx.academicYear?.id ?? null),
    authorize(viewer.userId, "academics.structure", "configure", { organizationId: ctx.organizationId, branchId: ctx.branch.id }),
  ]);
  const nextSequence = (grades.at(-1)?.sequence ?? 0) + 1;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Academic structure"
        description={
          <>
            {ctx.branch.name} · {ctx.academicYear ? `sections shown for ${ctx.academicYear.name}` : "no current academic year — sections can't be added until one is flagged current"}
          </>
        }
      />

      {ctx.branches.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-zinc-500 dark:text-zinc-400">Branch:</span>
          {ctx.branches.map((b) => (
            <Link
              key={b.id}
              href={`/settings/academic-structure?branch=${b.id}`}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                b.id === ctx.branch.id ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
              }`}
            >
              {b.name}
            </Link>
          ))}
        </div>
      ) : null}

      {grades.length === 0 ? (
        <EmptyState>No grades yet. Add the first one below.</EmptyState>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-4 py-2 font-medium">Grade</th>
                <th className="px-4 py-2 font-medium">Sections ({ctx.academicYear?.name ?? "—"})</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {grades.map((g) => (
                <tr key={g.id}>
                  <td className="px-4 py-2 text-zinc-500">{g.sequence}</td>
                  <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-50">{g.name}</td>
                  <td className="px-4 py-2 text-zinc-600 dark:text-zinc-300">
                    {g.sections.length === 0
                      ? "—"
                      : g.sections.map((s) => `${s.name} (${s._count.students}${s.capacity ? `/${s.capacity}` : ""})`).join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canConfigure ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card title="Add a grade">
            <GradeForm action={createGradeAction} branchId={ctx.branch.id} nextSequence={nextSequence} />
          </Card>
          <Card title="Add a section">
            {ctx.academicYear ? (
              <SectionForm action={createSectionAction} branchId={ctx.branch.id} grades={grades.map((g) => ({ id: g.id, name: g.name }))} />
            ) : (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Flag an academic year as current first.</p>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
