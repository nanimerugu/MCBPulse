import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { PERMISSIONS, permissionKey } from "../src/lib/permissions";
import { SYSTEM_ROLES, assertKnownPermissionKeys } from "../src/lib/roles";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set.");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// Prisma Client rejects `null` inside a compound-unique `where` selector at
// runtime ("Argument organizationId must not be null"), even though the
// field is nullable — so system roles (organizationId = null) can't use
// `upsert` against the organizationId_key compound unique. Find-then-write
// by hand instead; the DB-level partial unique index (see schema.prisma's
// comment on Role) is still what actually guarantees there's at most one
// match to find.
async function upsertSystemRole(data: { key: string; name: string; description: string; isSystem: boolean }) {
  const existing = await db.role.findFirst({ where: { organizationId: null, key: data.key } });
  if (existing) {
    return db.role.update({ where: { id: existing.id }, data: { name: data.name, description: data.description } });
  }
  return db.role.create({ data: { organizationId: null, ...data } });
}

async function getSystemRole(key: string) {
  return db.role.findFirstOrThrow({ where: { organizationId: null, key } });
}

async function main() {
  console.log("Seeding permissions...");
  for (const p of PERMISSIONS) {
    const key = permissionKey(p.module, p.action);
    await db.permission.upsert({
      where: { key },
      create: { key, module: p.module, action: p.action, description: p.description },
      update: { module: p.module, action: p.action, description: p.description },
    });
  }

  assertKnownPermissionKeys(new Set(PERMISSIONS.map((p) => permissionKey(p.module, p.action))));

  console.log("Seeding system roles...");
  for (const role of SYSTEM_ROLES) {
    const created = await upsertSystemRole({
      key: role.key,
      name: role.name,
      description: role.description,
      isSystem: true,
    });

    for (const key of role.permissions) {
      const permission = await db.permission.findUniqueOrThrow({ where: { key } });
      await db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: created.id, permissionId: permission.id } },
        create: { roleId: created.id, permissionId: permission.id },
        update: {},
      });
    }
  }

  console.log("Seeding demo organization...");
  const org = await db.organization.upsert({
    where: { slug: "nalanda-demo" },
    create: { name: "Nalanda Demo School Group", slug: "nalanda-demo", status: "TRIAL" },
    update: {},
  });

  const branch = await db.branch.upsert({
    where: { organizationId_code: { organizationId: org.id, code: "MAIN" } },
    create: { organizationId: org.id, name: "Nalanda Main Campus", code: "MAIN", status: "ACTIVE" },
    update: {},
  });

  const now = new Date();
  const yearName = `${now.getFullYear()}-${now.getFullYear() + 1}`;
  // Not referenced further below — Org Admin's demo assignment is org-wide
  // (see the comment near its upsert) — but the row itself still needs to
  // exist so the tenant hierarchy has a current academic year to show.
  await db.academicYear.upsert({
    where: { branchId_name: { branchId: branch.id, name: yearName } },
    create: {
      branchId: branch.id,
      name: yearName,
      startDate: new Date(now.getFullYear(), 3, 1),
      endDate: new Date(now.getFullYear() + 1, 2, 31),
      isCurrent: true,
    },
    update: {},
  });

  console.log("Seeding demo users...");
  const platformAdminRole = await getSystemRole("platform_admin");
  const orgAdminRole = await getSystemRole("organization_admin");

  const platformAdminPassword = await bcrypt.hash("ChangeMe!123", 12);
  const platformAdmin = await db.user.upsert({
    where: { email: "platform-admin@mcbpulse.local" },
    create: {
      email: "platform-admin@mcbpulse.local",
      name: "Platform Admin",
      passwordHash: platformAdminPassword,
      status: "ACTIVE",
    },
    update: {},
  });
  await db.roleAssignment.upsert({
    where: { id: `${platformAdmin.id}:${platformAdminRole.id}:${org.id}` },
    create: {
      id: `${platformAdmin.id}:${platformAdminRole.id}:${org.id}`,
      userId: platformAdmin.id,
      roleId: platformAdminRole.id,
      organizationId: org.id,
    },
    update: {},
  });

  const orgAdminPassword = await bcrypt.hash("ChangeMe!123", 12);
  const orgAdmin = await db.user.upsert({
    where: { email: "admin@nalanda-demo.local" },
    create: {
      email: "admin@nalanda-demo.local",
      name: "Nalanda Org Admin",
      passwordHash: orgAdminPassword,
      status: "ACTIVE",
    },
    update: {},
  });
  // Org Admin's blueprint scope is "all branches" (section 4's role table) —
  // branchId/academicYearId stay null, same as Platform Admin, so this
  // assignment isn't limited to one branch or year.
  await db.roleAssignment.upsert({
    where: { id: `${orgAdmin.id}:${orgAdminRole.id}:${org.id}` },
    create: {
      id: `${orgAdmin.id}:${orgAdminRole.id}:${org.id}`,
      userId: orgAdmin.id,
      roleId: orgAdminRole.id,
      organizationId: org.id,
    },
    // Re-running seed after the branch/year scoping bug above was fixed
    // must also repair any row a prior run already created with it set.
    update: { branchId: null, academicYearId: null },
  });

  console.log("Seeding feature flags...");
  await db.featureFlag.upsert({
    where: { key: "phase1.sis" },
    create: { key: "phase1.sis", description: "Student Information System module (Phase 1)", defaultEnabled: false },
    update: {},
  });
  await db.featureFlag.upsert({
    where: { key: "ai.copilot" },
    create: { key: "ai.copilot", description: "AI Gateway / school copilot (Phase 10)", defaultEnabled: false },
    update: {},
  });

  console.log("\nSeed complete.\n");
  console.log("Demo logins (change these passwords before any real use):");
  console.log("  platform-admin@mcbpulse.local / ChangeMe!123  (Platform Admin)");
  console.log("  admin@nalanda-demo.local / ChangeMe!123        (Organization Admin, Nalanda Demo School Group)");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
