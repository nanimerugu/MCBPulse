import { describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
vi.mock("@/lib/db", () => ({
  db: { roleAssignment: { findMany: (...args: unknown[]) => findMany(...args) } },
}));

const { authorize } = await import("@/lib/rbac");

function assignment(opts: {
  branchId?: string | null;
  academicYearId?: string | null;
  permissionKeys?: string[];
}) {
  return {
    branchId: opts.branchId ?? null,
    academicYearId: opts.academicYearId ?? null,
    role: {
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
