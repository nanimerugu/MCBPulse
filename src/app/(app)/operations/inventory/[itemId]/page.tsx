import { notFound } from "next/navigation";
import { withBranch } from "@/lib/branch-context";
import { heldPermissionKeys } from "@/lib/rbac";
import { Badge, Card, DescriptionList, EmptyState, Field, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadOpsAccess, param } from "@/modules/sis/access";
import { getInventoryItem } from "@/modules/operations/inventory.service";
import { isBelowReorderLevel, MOVEMENT_KINDS, MOVEMENT_LABELS } from "@/modules/operations/stock";
import { formatDate } from "@/modules/sis/labels";
import { recordStockMovementAction } from "@/app/(app)/operations/actions";

export default async function InventoryItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ itemId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ itemId }, sp] = await Promise.all([params, searchParams]);
  const result = await loadOpsAccess(param(sp, "branch"), "ops.inventory", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Item" />
        <AccessDenied result={result} permission="ops.inventory:view" />
      </>
    );
  }
  const { ctx, viewer } = result.access;

  const [item, held] = await Promise.all([
    getInventoryItem(itemId, { organizationId: ctx.organizationId, branchId: ctx.branch.id }),
    heldPermissionKeys(viewer.userId, ctx.organizationId),
  ]);
  if (!item) notFound();

  const hidden = { branchId: ctx.branch.id };

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={item.name}
        description={item.sku}
        actions={<LinkButton href={withBranch("/operations/inventory", ctx)}>Back to inventory</LinkButton>}
      />

      <Card title="Stock">
        <DescriptionList
          items={[
            { label: "On hand", value: `${item.quantityOnHand} ${item.unit}` },
            {
              label: "Reorder level",
              value: item.reorderLevel ? (
                <>
                  {item.reorderLevel} {isBelowReorderLevel(item) ? <Badge tone="amber">low</Badge> : null}
                </>
              ) : (
                "Not set"
              ),
            },
          ]}
        />
      </Card>

      {held.has("ops.inventory:edit") ? (
        <Card title="Record a movement">
          <ActionForm action={recordStockMovementAction.bind(null, itemId)} hidden={hidden} submitLabel="Record">
            <div className="flex flex-wrap gap-3">
              <Field label="Kind" htmlFor="sm-kind">
                <Select id="sm-kind" name="kind" defaultValue="ISSUE">
                  {MOVEMENT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {MOVEMENT_LABELS[k]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Quantity" htmlFor="sm-qty" hint="A stock-take may be negative; the others are positive.">
                <Input id="sm-qty" name="quantity" type="number" required defaultValue={1} />
              </Field>
              <Field label="Note" htmlFor="sm-note">
                <Input id="sm-note" name="note" maxLength={200} placeholder="Issued to Grade 5 A" />
              </Field>
            </div>
          </ActionForm>
        </Card>
      ) : null}

      <Card title="Movements">
        {item.movements.length === 0 ? (
          <EmptyState>No movements recorded.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {item.movements.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                <div>
                  <p className="font-medium text-zinc-900 dark:text-zinc-50">{MOVEMENT_LABELS[m.kind]}</p>
                  {m.note ? <p className="text-zinc-500 dark:text-zinc-400">{m.note}</p> : null}
                </div>
                <span className="flex items-center gap-3 tabular-nums text-zinc-500 dark:text-zinc-400">
                  <span className={m.quantity < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}>
                    {m.quantity > 0 ? "+" : ""}
                    {m.quantity}
                  </span>
                  <span>→ {m.quantityAfter}</span>
                  <span>{formatDate(m.createdAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
