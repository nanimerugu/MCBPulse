import Link from "next/link";
import { withBranch } from "@/lib/branch-context";
import { PageHeader } from "@/components/ui";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadAcademicsAccess, param } from "@/modules/sis/access";
import { getStaffForViewer } from "@/modules/academics/scope";

export default async function AcademicsIndexPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadAcademicsAccess(param(sp, "branch"), "academics.timetable", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Academics" />
        <AccessDenied result={result} permission="academics.timetable:view" />
      </>
    );
  }
  const { viewer, ctx } = result.access;
  const staff = await getStaffForViewer(viewer.userId, ctx.organizationId);

  const cards = [
    { href: "/academics/attendance", title: "Attendance", description: "Take or correct a section's daily register; 30-day summaries." },
    { href: "/academics/timetable", title: "Timetable", description: "Weekly slots per section, with teacher/room/section conflict checks." },
    ...(staff ? [{ href: "/academics/timetable?view=me", title: "My timetable", description: "Your own week, across every section you teach." }] : []),
    { href: "/academics/assignments", title: "Teaching assignments", description: "Which teacher takes which subject in which section — also what scopes a teacher's view." },
    { href: "/academics/subjects", title: "Subjects & curricula", description: "The organization-wide catalog." },
  ];

  return (
    <>
      <PageHeader title="Academics" description={`${ctx.branch.name}${ctx.academicYear ? ` · ${ctx.academicYear.name}` : ""}`} />
      <ul className="grid max-w-4xl grid-cols-1 gap-3 sm:grid-cols-2">
        {cards.map((c) => (
          <li key={c.href}>
            <Link
              href={withBranch(c.href, ctx)}
              className="block rounded-lg border border-zinc-200 p-4 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
            >
              <p className="font-medium text-zinc-900 dark:text-zinc-50">{c.title}</p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{c.description}</p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
