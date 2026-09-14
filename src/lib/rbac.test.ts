import { describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
vi.mock("@/lib/db", () => ({
  db: { roleAssignment: { findMany: (...args: unknown[]) => findMany(...args) } },
}));

const { authorize, resolveAccess } = await import("@/lib/rbac");

function assignment(opts: {
  branchId?: string | null;
  academicYearId?: string | null;
  permissionKeys?: string[];
  roleKey?: string;
}) {
  return {
    branchId: opts.branchId ?? null,
    academicYearId: opts.academicYearId ?? null,
    role: {
      key: opts.roleKey ?? "organization_admin",
      rolePermissions: (opts.permissionKeys ?? ["identity.users:view"]).map((key) => ({
        permission: { key },
      })),
    },
  };
}

describe("authorize (tenant scope)", () => {
  it("grants access via an org-wide assignment for any branch", async () => {
    findMany.mockResolvedValueOnce([assignment({ branchId: null })]);
    const allowed = await authorize("u1", "identity.users", "view", {
      organizationId: "org1",
      branchId: "branch-a",
    });
    expect(allowed).toBe(true);
  });

  it("denies a branch-scoped assignment for a different branch", async () => {
    findMany.mockResolvedValueOnce([assignment({ branchId: "branch-a" })]);
    const allowed = await authorize("u1", "identity.users", "view", {
      organizationId: "org1",
      branchId: "branch-b",
    });
    expect(allowed).toBe(false);
  });

  it("denies a branch-scoped assignment when the resource has no branch at all", async () => {
    findMany.mockResolvedValueOnce([assignment({ branchId: "branch-a" })]);
    const allowed = await authorize("u1", "identity.users", "view", { organizationId: "org1" });
    expect(allowed).toBe(false);
  });

  it("grants a branch-scoped assignment for the matching branch", async () => {
    findMany.mockResolvedValueOnce([assignment({ branchId: "branch-a" })]);
    const allowed = await authorize("u1", "identity.users", "view", {
      organizationId: "org1",
      branchId: "branch-a",
    });
    expect(allowed).toBe(true);
  });

  it("denies when no assignment carries the requested permission", async () => {
    findMany.mockResolvedValueOnce([assignment({ permissionKeys: ["audit.events:view"] })]);
    const allowed = await authorize("u1", "identity.users", "view", { organizationId: "org1" });
    expect(allowed).toBe(false);
  });

  it("denies when there are no assignments at all", async () => {
    findMany.mockResolvedValueOnce([]);
    const allowed = await authorize("u1", "identity.users", "view", { organizationId: "org1" });
    expect(allowed).toBe(false);
  });
});

describe("resolveAccess (attribute policy: section scoping)", () => {
  const scope = { organizationId: "org1", branchId: "branch-a" };
  const view = ["sis.students:view"];

  it("is section-scoped when the only granting role is a teacher", async () => {
    findMany.mockResolvedValueOnce([assignment({ branchId: "branch-a", roleKey: "teacher", permissionKeys: view })]);
    expect(await resolveAccess("u1", "sis.students", "view", scope)).toEqual({ allowed: true, sectionScoped: true });
  });

  it("is section-scoped for a class teacher too", async () => {
    findMany.mockResolvedValueOnce([assignment({ branchId: "branch-a", roleKey: "class_teacher", permissionKeys: view })]);
    expect(await resolveAccess("u1", "sis.students", "view", scope)).toEqual({ allowed: true, sectionScoped: true });
  });

  it("is NOT section-scoped when any granting role is broad — a principal who also teaches", async () => {
    findMany.mockResolvedValueOnce([
      assignment({ branchId: "branch-a", roleKey: "teacher", permissionKeys: view }),
      assignment({ branchId: null, roleKey: "principal", permissionKeys: view }),
    ]);
    expect(await resolveAccess("u1", "sis.students", "view", scope)).toEqual({ allowed: true, sectionScoped: false });
  });

  it("ignores a broad role that doesn't actually grant the permission", async () => {
    findMany.mockResolvedValueOnce([
      assignment({ branchId: "branch-a", roleKey: "teacher", permissionKeys: view }),
      assignment({ branchId: null, roleKey: "accountant", permissionKeys: ["finance.invoices:view"] }),
    ]);
    // Only the teacher grants sis.students:view, so the grant is scoped.
    expect(await resolveAccess("u1", "sis.students", "view", scope)).toEqual({ allowed: true, sectionScoped: true });
  });

  it("reports sectionScoped=false when denied", async () => {
    findMany.mockResolvedValueOnce([assignment({ branchId: "branch-a", roleKey: "teacher", permissionKeys: ["audit.events:view"] })]);
    expect(await resolveAccess("u1", "sis.students", "view", scope)).toEqual({ allowed: false, sectionScoped: false });
  });
});
