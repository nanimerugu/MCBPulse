import { withBranch } from "@/lib/branch-context";
import { db } from "@/lib/db";
import { heldPermissionKeys } from "@/lib/rbac";
import { Badge, Card, EmptyState, Field, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadOpsAccess, param } from "@/modules/sis/access";
import { listHostelBlocks } from "@/modules/operations/hostel.service";
import { isFull, occupancyTone, placesFree } from "@/modules/operations/capacity";
import { formatDate } from "@/modules/sis/labels";
import {
  allocateRoomAction,
  checkOutOfRoomAction,
  createHostelBlockAction,
  createHostelRoomAction,
} from "@/app/(app)/operations/actions";

export default async function HostelPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadOpsAccess(param(sp, "branch"), "ops.hostel", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Hostel" />
        <AccessDenied result={result} permission="ops.hostel:view" />
      </>
    );
  }
  const { ctx, viewer } = result.access;

  const [blocks, held, students] = await Promise.all([
    listHostelBlocks({ organizationId: ctx.organizationId, branchId: ctx.branch.id }),
    heldPermissionKeys(viewer.userId, ctx.organizationId),
    db.student.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null, status: "ENROLLED" },
      include: { currentSection: { include: { grade: true } }, hostelAllocations: { where: { allocatedTo: null } } },
      orderBy: { firstName: "asc" },
      take: 300,
    }),
  ]);

  const hidden = { branchId: ctx.branch.id };
  const canConfigure = held.has("ops.hostel:configure");
  const canAllocate = held.has("ops.hostel:edit");
  const today = new Date().toISOString().slice(0, 10);

  const beds = blocks.flatMap((b) => b.rooms).reduce((s, r) => s + r.capacity, 0);
  const occupied = blocks.flatMap((b) => b.rooms).reduce((s, r) => s + r.allocations.length, 0);
  const unhoused = students.filter((s) => s.hostelAllocations.length === 0);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Hostel"
        description={`${blocks.length} block${blocks.length === 1 ? "" : "s"} · ${occupied} of ${beds} bed${beds === 1 ? "" : "s"} occupied`}
        actions={<LinkButton href={withBranch("/operations", ctx)}>Back to Operations</LinkButton>}
      />

      {canConfigure ? (
        <Card title="Add a block">
          <ActionForm action={createHostelBlockAction} hidden={hidden} submitLabel="Add block" inline>
            <Field label="Name" htmlFor="hb-name">
              <Input id="hb-name" name="name" required maxLength={80} placeholder="Nilgiri Block" />
            </Field>
          </ActionForm>
        </Card>
      ) : null}

      {blocks.length === 0 ? (
        <EmptyState>No hostel blocks yet.</EmptyState>
      ) : (
        blocks.map((block) => (
          <Card key={block.id} title={block.name}>
            {canConfigure ? (
              <div className="mb-3 border-b border-zinc-200 pb-3 dark:border-zinc-800">
                <ActionForm action={createHostelRoomAction.bind(null, block.id)} hidden={hidden} submitLabel="Add room" inline>
                  <Field label="Room number" htmlFor={`hr-num-${block.id}`}>
                    <Input id={`hr-num-${block.id}`} name="roomNumber" required maxLength={20} placeholder="101" />
                  </Field>
                  <Field label="Beds" htmlFor={`hr-cap-${block.id}`}>
                    <Input id={`hr-cap-${block.id}`} name="capacity" type="number" min={1} max={50} defaultValue={4} />
                  </Field>
                </ActionForm>
              </div>
            ) : null}

            {block.rooms.length === 0 ? (
              <EmptyState>No rooms in this block.</EmptyState>
            ) : (
              <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {block.rooms.map((room) => {
                  const o = { capacity: room.capacity, occupied: room.allocations.length };
                  return (
                    <li key={room.id} className="py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Room {room.roomNumber}</p>
                        <Badge tone={occupancyTone(o)}>
                          {o.occupied}/{room.capacity} · {placesFree(o)} free
                        </Badge>
                      </div>

                      {room.allocations.length > 0 ? (
                        <ul className="mt-2 flex flex-col gap-1">
                          {room.allocations.map((a) => (
                            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                              <span>
                                {a.student.firstName} {a.student.lastName}
                                <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">
                                  {a.student.currentSection ? `${a.student.currentSection.grade.name}/${a.student.currentSection.name} · ` : ""}
                                  since {formatDate(a.allocatedFrom)}
                                </span>
                              </span>
                              {canAllocate ? (
                                <ActionForm action={checkOutOfRoomAction.bind(null, a.id)} hidden={hidden} submitLabel="Check out" inline>
                                  <input type="hidden" name="to" value={today} />
                                </ActionForm>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}

                      {canAllocate && !isFull(o) ? (
                        <div className="mt-2">
                          <ActionForm action={allocateRoomAction.bind(null, room.id)} hidden={hidden} submitLabel="Allocate" inline>
                            <Field label="" htmlFor={`ha-student-${room.id}`}>
                              <Select id={`ha-student-${room.id}`} name="studentId" required defaultValue="">
                                <option value="" disabled>
                                  Choose a student…
                                </option>
                                {unhoused.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.firstName} {s.lastName}
                                    {s.currentSection ? ` (${s.currentSection.grade.name}/${s.currentSection.name})` : ""}
                                  </option>
                                ))}
                              </Select>
                            </Field>
                            <input type="hidden" name="from" value={today} />
                          </ActionForm>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        ))
      )}
    </div>
  );
}
