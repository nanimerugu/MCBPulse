import Link from "next/link";
import { withBranch } from "@/lib/branch-context";
import { db } from "@/lib/db";
import { heldPermissionKeys } from "@/lib/rbac";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadOpsAccessAny, param } from "@/modules/sis/access";
import { OPS_LANDING_PERMISSIONS } from "@/modules/operations/nav";
import { loanState, LOAN_STATE_LABELS } from "@/modules/operations/library";
import { isBelowReorderLevel } from "@/modules/operations/stock";
import { formatDate } from "@/modules/sis/labels";

export default async function OperationsIndexPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadOpsAccessAny(param(sp, "branch"), OPS_LANDING_PERMISSIONS);
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Operations" />
        <AccessDenied result={result} permission="any ops.* permission" />
      </>
    );
  }
  const { ctx, viewer } = result.access;
  const held = await heldPermissionKeys(viewer.userId, ctx.organizationId);
  const now = new Date();

  const [onSite, overdue, lowStock, hostelBeds, onTransport] = await Promise.all([
    held.has("ops.visitors:view") ? db.visitorLog.count({ where: { branchId: ctx.branch.id, checkOutAt: null } }) : Promise.resolve(0),
    held.has("ops.library:view")
      ? db.libraryIssue.findMany({
          where: { returnedAt: null, dueAt: { lt: now }, libraryItem: { branchId: ctx.branch.id } },
          include: { libraryItem: true, student: true, staff: { include: { user: true } } },
          orderBy: { dueAt: "asc" },
          take: 5,
        })
      : Promise.resolve([]),
    held.has("ops.inventory:view")
      ? db.inventoryItem.findMany({ where: { branchId: ctx.branch.id, deletedAt: null }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
    held.has("ops.hostel:view")
      ? db.hostelAllocation.count({ where: { allocatedTo: null, hostelRoom: { hostelBlock: { branchId: ctx.branch.id } } } })
      : Promise.resolve(0),
    held.has("ops.transport:view") ? db.studentTransport.count({ where: { route: { branchId: ctx.branch.id } } }) : Promise.resolve(0),
  ]);

  const reorder = lowStock.filter(isBelowReorderLevel);

  const cards = [
    { href: "/operations/library", title: "Library", description: "Catalogue, loans and returns.", need: "ops.library:view" },
    { href: "/operations/inventory", title: "Inventory & store", description: "Stock levels, with a movement behind every number.", need: "ops.inventory:view" },
    { href: "/operations/transport", title: "Transport", description: "Vehicles, routes, stops and who rides where.", need: "ops.transport:view" },
    { href: "/operations/hostel", title: "Hostel", description: "Blocks, rooms and who sleeps where.", need: "ops.hostel:view" },
    { href: "/operations/visitors", title: "Gate register", description: "Who is on campus right now.", need: "ops.visitors:view" },
    { href: "/operations/infirmary", title: "Infirmary", description: "Clinic visits, and telling a guardian.", need: "ops.infirmary:view" },
    { href: "/operations/canteen", title: "Canteen", description: "Prepaid wallets, a menu and the till.", need: "ops.canteen:view" },
  ].filter((c) => held.has(c.need));

  const stats = [
    held.has("ops.visitors:view") ? `${onSite} visitor${onSite === 1 ? "" : "s"} on site` : null,
    held.has("ops.hostel:view") ? `${hostelBeds} bed${hostelBeds === 1 ? "" : "s"} occupied` : null,
    held.has("ops.transport:view") ? `${onTransport} on transport` : null,
  ].filter(Boolean);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader title="Operations" description={[ctx.branch.name, ...stats].join(" · ")} />

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {cards.map((c) => (
          <li key={c.href}>
            <Link
              href={withBranch(c.href, ctx)}
              className="block h-full rounded-lg border border-zinc-200 p-4 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
            >
              <p className="font-medium text-zinc-900 dark:text-zinc-50">{c.title}</p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{c.description}</p>
            </Link>
          </li>
        ))}
      </ul>

      {held.has("ops.library:view") ? (
        <Card title="Overdue books">
          {overdue.length === 0 ? (
            <EmptyState>Nothing overdue.</EmptyState>
          ) : (
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {overdue.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">{l.libraryItem.title}</span>
                  <span className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
                    {l.student ? `${l.student.firstName} ${l.student.lastName}` : (l.staff?.user.name ?? "—")} · due {formatDate(l.dueAt)}
                    <Badge tone="red">{LOAN_STATE_LABELS[loanState(l, now)].toLowerCase()}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {held.has("ops.inventory:view") ? (
        <Card title="At or below reorder level">
          {reorder.length === 0 ? (
            <EmptyState>Nothing needs reordering.</EmptyState>
          ) : (
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {reorder.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">{i.name}</span>
                  <span className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
                    {i.quantityOnHand} {i.unit} left · reorder at {i.reorderLevel}
                    <Badge tone="amber">low</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </div>
  );
}
