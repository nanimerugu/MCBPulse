import Link from "next/link";
import { withBranch } from "@/lib/branch-context";
import { Badge, Button, EmptyState, Input, LinkButton, PageHeader, Select, SuccessBanner } from "@/components/ui";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadSisAccess, param } from "@/modules/sis/access";
import { STUDENT_STATUSES, STUDENT_STATUS_LABELS, STUDENT_STATUS_TONES, fullName } from "@/modules/sis/labels";
import { listEnrollableSections, listStudents } from "@/modules/sis/students.service";
import { getSectionScope, sectionInScope } from "@/modules/academics/scope";
import type { StudentStatus } from "@/generated/prisma/enums";
import { authorize } from "@/lib/rbac";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function StudentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const result = await loadSisAccess(param(sp, "branch"), "sis.students", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Students" />
        <AccessDenied result={result} permission="sis.students:view" />
      </>
    );
  }
  const { viewer, ctx } = result.access;
  const scope = { organizationId: ctx.organizationId, branchId: ctx.branch.id };

  // Attribute policy: a teacher's view is limited to their assigned sections.
  const sectionScope = await getSectionScope(result.access);

  const q = param(sp, "q") ?? "";
  const statusParam = param(sp, "status");
  const status = STUDENT_STATUSES.includes(statusParam as StudentStatus) ? (statusParam as StudentStatus) : undefined;
  const requestedSection = param(sp, "section") || undefined;
  const sectionId = requestedSection && sectionInScope(sectionScope, requestedSection) ? requestedSection : undefined;
  const page = Math.max(1, Number(param(sp, "page") ?? "1") || 1);
  const imported = param(sp, "imported");

  const [data, allSections, canCreate, canExport] = await Promise.all([
    listStudents({ ...scope, q, status, sectionId, sectionIds: sectionScope.sectionIds, page }),
    listEnrollableSections(ctx.branch.id),
    authorize(viewer.userId, "sis.students", "create", scope),
    authorize(viewer.userId, "sis.students", "export", scope),
  ]);
  const sections = allSections.filter((s) => sectionInScope(sectionScope, s.id));

  const filterQs = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { branch: ctx.branches.length > 1 ? ctx.branch.id : undefined, q, status, section: sectionId, page: String(page), ...overrides };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const s = params.toString();
    return s ? `/students?${s}` : "/students";
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Students"
        description={
          <>
            {ctx.branch.name}
            {ctx.academicYear ? ` · ${ctx.academicYear.name}` : " · no current academic year"} · {data.total} student
            {data.total === 1 ? "" : "s"}
            {sectionScope.sectionIds !== null ? " · showing only your assigned sections" : ""}
          </>
        }
        actions={
          <>
            {canExport ? <LinkButton href={withBranch("/students/export", ctx)}>Export CSV</LinkButton> : null}
            {canCreate ? <LinkButton href={withBranch("/students/import", ctx)}>Import CSV</LinkButton> : null}
            {canCreate ? (
              <LinkButton href={withBranch("/students/new", ctx)} variant="primary">
                New student
              </LinkButton>
            ) : null}
          </>
        }
      />

      {imported ? <SuccessBanner message={`Imported ${imported} student${imported === "1" ? "" : "s"}.`} /> : null}

      {ctx.branches.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-zinc-500 dark:text-zinc-400">Branch:</span>
          {ctx.branches.map((b) => (
            <Link
              key={b.id}
              href={`/students?branch=${b.id}`}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                b.id === ctx.branch.id
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
              }`}
            >
              {b.name}
            </Link>
          ))}
        </div>
      ) : null}

      <form method="get" action="/students" className="flex flex-wrap items-end gap-3">
        {ctx.branches.length > 1 ? <input type="hidden" name="branch" value={ctx.branch.id} /> : null}
        <div className="min-w-64 flex-1">
          <Input name="q" defaultValue={q} placeholder="Name, admission number or guardian phone" aria-label="Search" />
        </div>
        <Select name="status" defaultValue={status ?? ""} aria-label="Status" className="w-40">
          <option value="">Any status</option>
          {STUDENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STUDENT_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <Select name="section" defaultValue={sectionId ?? ""} aria-label="Section" className="w-48">
          <option value="">Any section</option>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.grade.name} / {s.name}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {data.items.length === 0 ? (
        <EmptyState>
          {q || status || sectionId
            ? "No students match these filters."
            : sectionScope.sectionIds !== null && sectionScope.sectionIds.length === 0
              ? "You aren't assigned to any section yet, so there are no students to show."
              : "No students in this branch yet. Add one, or import a CSV."}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2 font-medium">Admission no.</th>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Grade / section</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Primary guardian</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {data.items.map((s) => {
                const primary = s.guardianLinks[0]?.guardian;
                return (
                  <tr key={s.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/60">
                    <td className="px-4 py-2 font-mono text-xs text-zinc-600 dark:text-zinc-300">{s.admissionNumber}</td>
                    <td className="px-4 py-2">
                      <Link href={withBranch(`/students/${s.id}`, ctx)} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                        {fullName(s)}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-300">
                      {s.currentSection ? `${s.currentSection.grade.name} / ${s.currentSection.name}` : "—"}
                    </td>
                    <td className="px-4 py-2">
                      <Badge tone={STUDENT_STATUS_TONES[s.status]}>{STUDENT_STATUS_LABELS[s.status]}</Badge>
                    </td>
                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-300">
                      {primary ? `${fullName(primary)} · ${primary.phone}` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data.pageCount > 1 ? (
        <div className="flex items-center justify-between text-sm text-zinc-500 dark:text-zinc-400">
          <span>
            Page {data.page} of {data.pageCount}
          </span>
          <div className="flex gap-2">
            {data.page > 1 ? (
              <Link href={filterQs({ page: String(data.page - 1) })} className="hover:underline">
                ← Previous
              </Link>
            ) : null}
            {data.page < data.pageCount ? (
              <Link href={filterQs({ page: String(data.page + 1) })} className="hover:underline">
                Next →
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
