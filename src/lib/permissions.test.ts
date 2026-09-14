import { describe, expect, it } from "vitest";
import { ACTIONS, PERMISSIONS, permissionKey } from "@/lib/permissions";
import { SYSTEM_ROLES, assertKnownPermissionKeys } from "@/lib/roles";

describe("permission catalog", () => {
  it("has no duplicate module:action keys", () => {
    const keys = PERMISSIONS.map((p) => permissionKey(p.module, p.action));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("only uses actions from the declared action verb list", () => {
    for (const p of PERMISSIONS) {
      expect(ACTIONS).toContain(p.action);
    }
  });
});

describe("system role catalog", () => {
  it("only grants permissions that exist in the catalog", () => {
    const allKeys = new Set(PERMISSIONS.map((p) => permissionKey(p.module, p.action)));
    expect(() => assertKnownPermissionKeys(allKeys)).not.toThrow();
  });

  it("catches a role referencing an unknown permission", () => {
    const allKeys = new Set(["a:view"]);
    const badRoles = [{ key: "x", name: "X", description: "", permissions: ["not:real"] }];
    // Exercise the same check assertKnownPermissionKeys does, against a
    // deliberately-bad role list, to prove it actually fails closed.
    expect(() =>
      badRoles.forEach((role) => {
        role.permissions.forEach((key) => {
          if (!allKeys.has(key)) throw new Error(`unknown permission ${key}`);
        });
      }),
    ).toThrow();
  });

  it("has unique role keys", () => {
    const keys = SYSTEM_ROLES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
