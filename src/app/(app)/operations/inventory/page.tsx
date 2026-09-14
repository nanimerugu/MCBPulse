import Link from "next/link";
import { withBranch } from "@/lib/branch-context";
import { heldPermissionKeys } from "@/lib/rbac";
import { Badge, Card, EmptyState, Field, Input, LinkButton, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadOpsAccess, param } from "@/modules/sis/access";
import { listInventoryItems } from "@/modules/operations/inventory.service";
import { isBelowReorderLevel } from "@/modules/operations/stock";
import { createInventoryItemAction } from "@/app/(app)/operations/actions";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadOpsAccess(param(sp, "branch"), "ops.inventory", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Inventory & store" />
        <AccessDenied result={result} permission="ops.inventory:view" />
      </>
    );
  }
  const { ctx, viewer } = result.access;

  const [items, held] = await Promise.all([
    listInventoryItems({ organizationId: ctx.organizationId, branchId: ctx.branch.id }),
    heldPermissionKeys(viewer.userId, ctx.organizationId),
  ]);
  const hidden = { branchId: ctx.branch.id };
  const low = items.filter(isBelowReorderLevel).length;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Inventory & store"
        description={`${items.length} item${items.length === 1 ? "" : "s"}${low > 0 ? ` · ${low} at or below reorder level` : ""}`}
        actions={<LinkButton href={withBranch("/operations", ctx)}>Back to Operations</LinkButton>}
      />

      {held.has("ops.inventory:create") ? (
        <Card title="Add an item">
          <ActionForm action={createInventoryItemAction} hidden={hidden} submitLabel="Add item">
            <div className="flex flex-wrap gap-3">
              <Field label="Name" htmlFor="iv-name">
                <Input id="iv-name" name="name" required maxLength={120} placeholder="Whiteboard marker" />
              </Field>
              <Field label="SKU" htmlFor="iv-sku">
                <Input id="iv-sku" name="sku" required maxLength={40} placeholder="STA-WBM-BLK" />
              </Field>
              <Field label="Unit" htmlFor="iv-unit">
                <Input id="iv-unit" name="unit" maxLength={20} defaultValue="unit" />
              </Field>
              <Field label="Opening stock" htmlFor="iv-open">
                <Input id="iv-open" name="openingQuantity" type="number" min={0} defaultValue={0} />
              </Field>
              <Field label="Reorder at" htmlFor="iv-reorder" hint="0 to never flag">
                <Input id="iv-reorder" name="reorderLevel" type="number" min={0} defaultValue={0} />
              </Field>
            </div>
          </ActionForm>
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            Opening stock is recorded as a receipt, so even the first number has a movement behind it.
          </p>
        </Card>
      ) : null}

      <Card title="Stock">
        {items.length === 0 ? (
          <EmptyState>No items yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <tr>
                  <th className="py-2 pr-4 font-medium">SKU</th>
                  <th className="py-2 pr-4 font-medium">Item</th>
                  <th className="py-2 pr-4 text-right font-medium">On hand</th>
                  <th className="py-2 text-right font-medium">Reorder at</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {items.map((i) => (
                  <tr key={i.id}>
                    <td className="py-2 pr-4 font-mono text-xs">{i.sku}</td>
                    <td className="py-2 pr-4">
                      <Link href={withBranch(`/operations/inventory/${i.id}`, ctx)} className="font-medium hover:underline">
                        {i.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {i.quantityOnHand} {i.unit}
                      {isBelowReorderLevel(i) ? (
                        <span className="ml-2">
                          <Badge tone="amber">low</Badge>
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 text-right tabular-nums text-zinc-500 dark:text-zinc-400">{i.reorderLevel || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
