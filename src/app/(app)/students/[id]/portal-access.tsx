import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, Input } from "@/components/ui";
import { formatDate } from "@/modules/sis/labels";
import type { PortalAccess, PortalTarget } from "@/modules/identity/portal-access.service";
import { invitePortalAction, resetPortalPasswordAction, withdrawPortalAction } from "@/app/(app)/students/portal-actions";

export function PortalStatus({ access }: { access: PortalAccess }) {
  switch (access.state) {
    case "none":
      return <Badge tone="neutral">no portal login</Badge>;
    case "invited":
      return access.expiresAt ? (
        <Badge tone="amber">invited · link expires {formatDate(access.expiresAt)}</Badge>
      ) : (
        <Badge tone="red">invitation expired</Badge>
      );
    case "active":
      return <Badge tone="green">portal active · {access.lastLoginAt ? `last in ${formatDate(access.lastLoginAt)}` : "never signed in"}</Badge>;
    case "withdrawn":
      return <Badge tone="neutral">access withdrawn</Badge>;
  }
}

function Controls({ target, access, branchId, needsEmail }: { target: PortalTarget; access: PortalAccess; branchId: string; needsEmail?: boolean }) {
  const hidden = { branchId };
  const canInvite = access.state !== "active";
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      {canInvite ? (
        <ActionForm
          action={invitePortalAction.bind(null, target)}
          hidden={hidden}
          submitLabel={access.state === "invited" ? "Resend invitation" : "Invite to portal"}
          pendingLabel="Inviting…"
          inline
        >
          {needsEmail ? (
            <Field label="Sign-in email" htmlFor={`pe-${target.studentId}`}>
              <Input
                id={`pe-${target.studentId}`}
                name="email"
                type="email"
                required
                defaultValue={access.state === "invited" || access.state === "withdrawn" ? access.email : ""}
                className="!w-64"
              />
            </Field>
          ) : null}
        </ActionForm>
      ) : (
        <ActionForm action={resetPortalPasswordAction.bind(null, target)} hidden={hidden} submitLabel="Send password reset" pendingLabel="Sending…" inline />
      )}
      {access.state === "active" || access.state === "invited" ? (
        <ActionForm action={withdrawPortalAction.bind(null, target)} hidden={hidden} submitLabel="Withdraw access" variant="danger" inline />
      ) : null}
    </div>
  );
}

/** Under each guardian on the Student 360. */
export function GuardianPortalControls({
  access,
  guardianId,
  studentId,
  branchId,
  hasEmail,
  canManage,
}: {
  access: PortalAccess;
  guardianId: string;
  studentId: string;
  branchId: string;
  hasEmail: boolean;
  canManage: boolean;
}) {
  return (
    <div className="mt-1.5">
      <PortalStatus access={access} />
      {canManage ? (
        hasEmail || access.state !== "none" ? (
          <Controls target={{ kind: "guardian", guardianId, studentId }} access={access} branchId={branchId} />
        ) : (
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Add an email address to invite them — it becomes their sign-in name.</p>
        )
      ) : null}
    </div>
  );
}

/** The student's own login. */
export function StudentLoginCard({ access, studentId, branchId, canManage, enrolled }: { access: PortalAccess; studentId: string; branchId: string; canManage: boolean; enrolled: boolean }) {
  return (
    <Card title="Student login">
      <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-300">
        A student login shows their own timetable, attendance, homework and published reports, and lets them hand in work. It never shows fees.
      </p>
      <PortalStatus access={access} />
      {canManage ? (
        enrolled || access.state !== "none" ? (
          <Controls target={{ kind: "student", studentId }} access={access} branchId={branchId} needsEmail />
        ) : (
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Only an enrolled student can be given a login.</p>
        )
      ) : null}
    </Card>
  );
}
