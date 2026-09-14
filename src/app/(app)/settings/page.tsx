import Link from "next/link";
import { PageHeader } from "@/components/ui";

const SETTINGS = [
  { href: "/settings/users", title: "Users & roles", description: "Who has which role, and where." },
  { href: "/settings/academic-structure", title: "Academic structure", description: "Grades and sections for the current academic year." },
  { href: "/settings/year-end", title: "Year end", description: "Open next year, decide every student's move, and switch years in one step." },
];

export default function SettingsIndexPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <ul className="grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2">
        {SETTINGS.map((s) => (
          <li key={s.href}>
            <Link
              href={s.href}
              className="block rounded-lg border border-zinc-200 p-4 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
            >
              <p className="font-medium text-zinc-900 dark:text-zinc-50">{s.title}</p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{s.description}</p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
