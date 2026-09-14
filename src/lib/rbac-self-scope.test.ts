import { describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
vi.mock("@/lib/db", () => ({
  db: { roleAssignment: { findMany: (...args: unknown[]) => findMany(...args) } },
}));

const { resolveAccess } = await import("@/lib/rbac");

function assignment(roleKey: string, permissionKeys = ["sis.students:view"]) {
  return {
    branchId: null,
    academicYearId: null,
    role: { key: roleKey, rolePermissions: permissionKeys.map((key) => ({ permission: { key } })) },
  };
}

const scope = { organizationId: "org1", branchId: "branch-a" };

/**
 * The property these protect: `selfScoped` must be true whenever EVERY
 * granting role is self-scoped, because the staff gate refuses on it. A
 * false negative here hands a parent the whole student roster.
 */
describe("resolveAccess (self scope)", () => {
  it("marks a parent's grant as self-scoped", async () => {
    findMany.mockResolvedValueOnce([assignment("parent")]);
    const d = await resolveAccess("u1", "sis.students", "view", scope);
    expect(d).toEqual({ allowed: true, sectionScoped: false, selfScoped: true });
  });

  it("marks a student's and a driver's grants as self-scoped", async () => {
    findMany.mockResolvedValueOnce([assignment("student")]);
    expect((await resolveAccess("u1", "sis.students", "view", scope)).selfScoped).toBe(true);
    findMany.mockResolvedValueOnce([assignment("driver")]);
    expect((await resolveAccess("u1", "sis.students", "view", scope)).selfScoped).toBe(true);
  });

  it("does NOT mark a staff grant as self-scoped", async () => {
    findMany.mockResolvedValueOnce([assignment("organization_admin")]);
    const d = await resolveAccess("u1", "sis.students", "view", scope);
    expect(d.selfScoped).toBe(false);
    expect(d.allowed).toBe(true);
  });

  it("lifts the restriction when one broad role also grants it", async () => {
    // A parent who is also a teacher at the school: the staff grant is real,
    // so the decision must not be narrowed to their own children.
    findMany.mockResolvedValueOnce([assignment("parent"), assignment("principal")]);
    const d = await resolveAccess("u1", "sis.students", "view", scope);
    expect(d.selfScoped).toBe(false);
  });

  it("stays self-scoped when several self-scoped roles grant it", async () => {
    // A parent at the school whose own child also attends it.
    findMany.mockResolvedValueOnce([assignment("parent"), assignment("student")]);
    expect((await resolveAccess("u1", "sis.students", "view", scope)).selfScoped).toBe(true);
  });

  it("is false when nothing grants the permission at all", async () => {
    findMany.mockResolvedValueOnce([assignment("parent", ["finance.invoices:view"])]);
    const d = await resolveAccess("u1", "sis.students", "view", scope);
    expect(d).toEqual({ allowed: false, sectionScoped: false, selfScoped: false });
  });

  it("does not confuse section scoping with self scoping", async () => {
    findMany.mockResolvedValueOnce([assignment("teacher")]);
    const d = await resolveAccess("u1", "sis.students", "view", scope);
    expect(d.sectionScoped).toBe(true);
    expect(d.selfScoped).toBe(false);
  });

  it("ignores a self-scoped assignment scoped to another branch", async () => {
    const other = { ...assignment("parent"), branchId: "branch-b" };
    findMany.mockResolvedValueOnce([other]);
    const d = await resolveAccess("u1", "sis.students", "view", scope);
    expect(d.allowed).toBe(false);
  });
});
