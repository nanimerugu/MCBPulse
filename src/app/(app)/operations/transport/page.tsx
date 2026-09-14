import { withBranch } from "@/lib/branch-context";
import { db } from "@/lib/db";
import { heldPermissionKeys } from "@/lib/rbac";
import { Badge, Card, EmptyState, Field, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadOpsAccess, param } from "@/modules/sis/access";
import { listRoutes, listTransportAllocations, listVehicles } from "@/modules/operations/transport.service";
import { occupancyTone, placesFree } from "@/modules/operations/capacity";
import {
  addRouteStopAction,
  allocateTransportAction,
  createRouteAction,
  createVehicleAction,
  removeTransportAction,
} from "@/app/(app)/operations/actions";

export default async function TransportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadOpsAccess(param(sp, "branch"), "ops.transport", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Transport" />
        <AccessDenied result={result} permission="ops.transport:view" />
      </>
    );
  }
  const { ctx, viewer } = result.access;
  const scope = { organizationId: ctx.organizationId, branchId: ctx.branch.id };

  const [vehicles, routes, allocations, held, drivers, students] = await Promise.all([
    listVehicles(scope),
    listRoutes(scope),
    listTransportAllocations(scope),
    heldPermissionKeys(viewer.userId, ctx.organizationId),
    db.staff.findMany({
      where: { organizationId: ctx.organizationId, branchId: ctx.branch.id, deletedAt: null, exitDate: null },
      include: { user: true },
      orderBy: { employeeCode: "asc" },
    }),
    db.student.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null, status: "ENROLLED" },
      include: { currentSection: { include: { grade: true } }, transportLink: true },
      orderBy: { firstName: "asc" },
      take: 300,
    }),
  ]);

  const hidden = { branchId: ctx.branch.id };
  const canConfigure = held.has("ops.transport:configure");
  const canAllocate = held.has("ops.transport:edit");

  // Seats are counted per VEHICLE across all its routes — one bus has one set
  // of seats however many runs it does.
  const seatsByVehicle = new Map(vehicles.map((v) => [v.id, v.routes.reduce((s, r) => s + r._count.studentTransports, 0)]));

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Transport"
        description={`${vehicles.length} vehicle${vehicles.length === 1 ? "" : "s"} · ${routes.length} route${routes.length === 1 ? "" : "s"} · ${allocations.length} student${allocations.length === 1 ? "" : "s"} riding`}
        actions={<LinkButton href={withBranch("/operations", ctx)}>Back to Operations</LinkButton>}
      />

      {canConfigure ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card title="Add a vehicle">
            <ActionForm action={createVehicleAction} hidden={hidden} submitLabel="Add vehicle">
              <Field label="Registration" htmlFor="tv-reg">
                <Input id="tv-reg" name="registrationNumber" required maxLength={20} placeholder="KA-01-AB-1234" />
              </Field>
              <Field label="Seats" htmlFor="tv-cap">
                <Input id="tv-cap" name="capacity" type="number" min={1} max={200} defaultValue={40} />
              </Field>
              <Field label="Driver" htmlFor="tv-driver">
                <Select id="tv-driver" name="driverStaffId" defaultValue="">
                  <option value="">Unassigned</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.user.name} ({d.employeeCode})
                    </option>
                  ))}
                </Select>
              </Field>
            </ActionForm>
          </Card>

          <Card title="Add a route">
            <ActionForm action={createRouteAction} hidden={hidden} submitLabel="Add route">
              <Field label="Name" htmlFor="tr-name">
                <Input id="tr-name" name="name" required maxLength={80} placeholder="North loop — morning" />
              </Field>
              <Field label="Vehicle" htmlFor="tr-vehicle" hint="A route without a vehicle has no seat limit yet.">
                <Select id="tr-vehicle" name="vehicleId" defaultValue="">
                  <option value="">Unassigned</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.registrationNumber} ({v.capacity} seats)
                    </option>
                  ))}
                </Select>
              </Field>
            </ActionForm>
          </Card>
        </div>
      ) : null}

      <Card title="Vehicles">
        {vehicles.length === 0 ? (
          <EmptyState>No vehicles yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {vehicles.map((v) => {
              const occupied = seatsByVehicle.get(v.id) ?? 0;
              const o = { capacity: v.capacity, occupied };
              return (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                  <div>
                    <p className="font-medium text-zinc-900 dark:text-zinc-50">{v.registrationNumber}</p>
                    <p className="text-zinc-500 dark:text-zinc-400">
                      {v.driverStaff ? `Driver ${v.driverStaff.user.name}` : "No driver assigned"} ·{" "}
                      {v.routes.length} route{v.routes.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <Badge tone={occupancyTone(o)}>
                    {occupied}/{v.capacity} seats · {placesFree(o)} free
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="Routes & stops">
        {routes.length === 0 ? (
          <EmptyState>No routes yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {routes.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{r.name}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {r.vehicle ? r.vehicle.registrationNumber : "No vehicle"} · {r._count.studentTransports} riding
                    </p>
                  </div>
                  {canConfigure ? (
                    <ActionForm action={addRouteStopAction.bind(null, r.id)} hidden={hidden} submitLabel="Add stop" inline>
                      <Field label="" htmlFor={`stop-${r.id}`}>
                        <Input id={`stop-${r.id}`} name="name" required maxLength={80} placeholder="Stop name" />
                      </Field>
                    </ActionForm>
                  ) : null}
                </div>
                {r.stops.length > 0 ? (
                  <ol className="mt-2 flex flex-wrap gap-1.5">
                    {r.stops.map((s) => (
                      <li key={s.id} className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                        {s.sequence}. {s.name}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-600">No stops yet — a student can&apos;t be allocated until there is one.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canAllocate && routes.some((r) => r.stops.length > 0) ? (
        <Card title="Put a student on a route">
          <ActionForm action={allocateTransportAction} hidden={hidden} submitLabel="Allocate">
            <div className="flex flex-wrap gap-3">
              <Field label="Student" htmlFor="ta-student">
                <Select id="ta-student" name="studentId" required defaultValue="">
                  <option value="" disabled>
                    Choose…
                  </option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.firstName} {s.lastName}
                      {s.currentSection ? ` (${s.currentSection.grade.name}/${s.currentSection.name})` : ""}
                      {s.transportLink ? " — already riding" : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Route" htmlFor="ta-route">
                <Select id="ta-route" name="routeId" required defaultValue="">
                  <option value="" disabled>
                    Choose…
                  </option>
                  {routes
                    .filter((r) => r.stops.length > 0)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="Stop" htmlFor="ta-stop" hint="Must belong to the route chosen.">
                <Select id="ta-stop" name="stopId" required defaultValue="">
                  <option value="" disabled>
                    Choose…
                  </option>
                  {routes.flatMap((r) =>
                    r.stops.map((s) => (
                      <option key={s.id} value={s.id}>
                        {r.name} — {s.sequence}. {s.name}
                      </option>
                    )),
                  )}
                </Select>
              </Field>
            </div>
          </ActionForm>
        </Card>
      ) : null}

      <Card title="Who rides where">
        {allocations.length === 0 ? (
          <EmptyState>Nobody is on transport yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {allocations.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                <div>
                  <p className="font-medium text-zinc-900 dark:text-zinc-50">
                    {a.student.firstName} {a.student.lastName}
                  </p>
                  <p className="text-zinc-500 dark:text-zinc-400">
                    {a.route.name} · {a.stop.sequence}. {a.stop.name}
                    {a.route.vehicle ? ` · ${a.route.vehicle.registrationNumber}` : ""}
                    {a.student.currentSection ? ` · ${a.student.currentSection.grade.name}/${a.student.currentSection.name}` : ""}
                  </p>
                </div>
                {canAllocate ? (
                  <ActionForm action={removeTransportAction.bind(null, a.studentId)} hidden={hidden} submitLabel="Remove" variant="danger" inline />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
