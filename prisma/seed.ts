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
  const academicYear = await db.academicYear.upsert({
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

  console.log("Seeding demo academic structure...");
  const sectionIds = new Map<string, string>(); // "Grade 5|A" -> id
  for (const [name, sequence] of [["Grade 1", 1], ["Grade 2", 2], ["Grade 3", 3], ["Grade 4", 4], ["Grade 5", 5]] as const) {
    const grade = await db.grade.upsert({
      where: { branchId_name: { branchId: branch.id, name } },
      create: { branchId: branch.id, name, sequence },
      update: { sequence },
    });
    for (const sectionName of ["A", "B"]) {
      const section = await db.section.upsert({
        where: { gradeId_academicYearId_name: { gradeId: grade.id, academicYearId: academicYear.id, name: sectionName } },
        create: { gradeId: grade.id, academicYearId: academicYear.id, name: sectionName, capacity: 30 },
        update: {},
      });
      sectionIds.set(`${name}|${sectionName}`, section.id);
    }
  }

  console.log("Seeding demo students...");
  // Guardians are people shared across siblings — Priya and Rohan Rao share
  // one father record, which is the sibling model the blueprint asks for.
  const demoStudents: {
    admissionNumber: string;
    firstName: string;
    lastName: string;
    dob: string;
    gender: string;
    section: string | null;
    guardian: { firstName: string; lastName: string; phone: string; relationship: "FATHER" | "MOTHER" | "GUARDIAN" | "OTHER" } | null;
  }[] = [
    { admissionNumber: "N-1001", firstName: "Priya", lastName: "Rao", dob: "2015-06-12", gender: "F", section: "Grade 5|A", guardian: { firstName: "Anil", lastName: "Rao", phone: "9000000001", relationship: "FATHER" } },
    { admissionNumber: "N-1002", firstName: "Rohan", lastName: "Rao", dob: "2017-09-03", gender: "M", section: "Grade 3|B", guardian: { firstName: "Anil", lastName: "Rao", phone: "9000000001", relationship: "FATHER" } },
    { admissionNumber: "N-1003", firstName: "Meera", lastName: "Iyer", dob: "2015-01-28", gender: "F", section: "Grade 5|A", guardian: { firstName: "Lakshmi", lastName: "Iyer", phone: "9000000002", relationship: "MOTHER" } },
    { admissionNumber: "N-1004", firstName: "Arjun", lastName: "Reddy", dob: "2016-11-15", gender: "M", section: "Grade 4|A", guardian: null },
    { admissionNumber: "N-1005", firstName: "Sara", lastName: "Khan", dob: "2019-04-20", gender: "F", section: null, guardian: { firstName: "Imran", lastName: "Khan", phone: "9000000003", relationship: "FATHER" } },
    { admissionNumber: "N-1006", firstName: "Dev", lastName: "Patel", dob: "2019-08-08", gender: "M", section: "Grade 1|A", guardian: { firstName: "Nisha", lastName: "Patel", phone: "9000000004", relationship: "MOTHER" } },
  ];
  for (const s of demoStudents) {
    const sectionId = s.section ? sectionIds.get(s.section)! : null;
    const student = await db.student.upsert({
      where: { organizationId_admissionNumber: { organizationId: org.id, admissionNumber: s.admissionNumber } },
      create: {
        organizationId: org.id,
        branchId: branch.id,
        admissionNumber: s.admissionNumber,
        firstName: s.firstName,
        lastName: s.lastName,
        dateOfBirth: new Date(`${s.dob}T00:00:00.000Z`),
        gender: s.gender,
        status: sectionId ? "ENROLLED" : "ENQUIRY",
        currentSectionId: sectionId,
        admissionDate: sectionId ? new Date(`${now.getFullYear()}-04-01T00:00:00.000Z`) : null,
      },
      update: {},
    });
    if (s.guardian) {
      const guardian =
        (await db.guardian.findFirst({ where: { phone: s.guardian.phone, deletedAt: null } })) ??
        (await db.guardian.create({ data: { firstName: s.guardian.firstName, lastName: s.guardian.lastName, phone: s.guardian.phone } }));
      await db.studentGuardian.upsert({
        where: { studentId_guardianId: { studentId: student.id, guardianId: guardian.id } },
        create: { studentId: student.id, guardianId: guardian.id, relationship: s.guardian.relationship, isPrimary: true },
        update: {},
      });
    }
  }

  console.log("Seeding demo academics...");
  const subjectIds = new Map<string, string>();
  for (const [code, name] of [["ENG", "English"], ["MAT", "Mathematics"], ["SCI", "Science"], ["SST", "Social Studies"], ["HIN", "Hindi"]] as const) {
    const subject = await db.subject.upsert({
      where: { organizationId_code: { organizationId: org.id, code } },
      create: { organizationId: org.id, code, name },
      update: { name },
    });
    subjectIds.set(code, subject.id);
  }
  // Curriculum has no natural unique key, so find-then-create.
  if (!(await db.curriculum.findFirst({ where: { organizationId: org.id, type: "CBSE", deletedAt: null } }))) {
    await db.curriculum.create({ data: { organizationId: org.id, name: "CBSE", type: "CBSE" } });
  }

  // A demo teacher with a login, a staff record, a branch-scoped Teacher
  // role, and teaching assignments — the attribute policy has something to
  // scope by, and the teacher dashboard has something to show.
  const teacherRole = await getSystemRole("teacher");
  const teacherUser = await db.user.upsert({
    where: { email: "teacher@nalanda-demo.local" },
    create: { email: "teacher@nalanda-demo.local", name: "Ravi Kumar", passwordHash: await bcrypt.hash("ChangeMe!123", 12), status: "ACTIVE" },
    update: {},
  });
  const teacherStaff = await db.staff.upsert({
    where: { organizationId_employeeCode: { organizationId: org.id, employeeCode: "T-100" } },
    create: {
      organizationId: org.id,
      branchId: branch.id,
      userId: teacherUser.id,
      employeeCode: "T-100",
      designation: "Mathematics Teacher",
      joinDate: new Date(`${now.getFullYear()}-04-01T00:00:00.000Z`),
    },
    update: {},
  });
  await db.roleAssignment.upsert({
    where: { id: `${teacherUser.id}:${teacherRole.id}:${org.id}:${branch.id}` },
    create: { id: `${teacherUser.id}:${teacherRole.id}:${org.id}:${branch.id}`, userId: teacherUser.id, roleId: teacherRole.id, organizationId: org.id, branchId: branch.id },
    update: {},
  });
  const assign = async (sectionKey: string, code: string) => {
    const sectionId = sectionIds.get(sectionKey)!;
    const subjectId = subjectIds.get(code)!;
    await db.subjectAssignment.upsert({
      where: { sectionId_subjectId: { sectionId, subjectId } },
      create: { sectionId, subjectId, staffId: teacherStaff.id },
      update: {},
    });
  };
  await assign("Grade 5|A", "MAT");
  await assign("Grade 5|A", "SCI");
  await assign("Grade 3|B", "MAT");

  // TimetableSlot has no unique key; check before inserting so re-runs don't duplicate.
  const slots: { sectionKey: string; code: string; day: "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY"; start: string; end: string; room: string }[] = [
    { sectionKey: "Grade 5|A", code: "MAT", day: "MONDAY", start: "09:00", end: "09:45", room: "R-12" },
    { sectionKey: "Grade 5|A", code: "MAT", day: "WEDNESDAY", start: "09:00", end: "09:45", room: "R-12" },
    { sectionKey: "Grade 5|A", code: "MAT", day: "FRIDAY", start: "09:00", end: "09:45", room: "R-12" },
    { sectionKey: "Grade 5|A", code: "SCI", day: "TUESDAY", start: "10:00", end: "10:45", room: "LAB-1" },
    { sectionKey: "Grade 5|A", code: "SCI", day: "THURSDAY", start: "10:00", end: "10:45", room: "LAB-1" },
    { sectionKey: "Grade 3|B", code: "MAT", day: "MONDAY", start: "11:00", end: "11:45", room: "R-04" },
    { sectionKey: "Grade 3|B", code: "MAT", day: "TUESDAY", start: "11:00", end: "11:45", room: "R-04" },
    { sectionKey: "Grade 3|B", code: "MAT", day: "THURSDAY", start: "11:00", end: "11:45", room: "R-04" },
  ];
  for (const s of slots) {
    const sectionId = sectionIds.get(s.sectionKey)!;
    const exists = await db.timetableSlot.findFirst({ where: { sectionId, dayOfWeek: s.day, startTime: s.start } });
    if (!exists) {
      await db.timetableSlot.create({
        data: { sectionId, subjectId: subjectIds.get(s.code)!, staffId: teacherStaff.id, dayOfWeek: s.day, startTime: s.start, endTime: s.end, room: s.room },
      });
    }
  }

  console.log("Seeding demo admissions...");
  const sourceIds = new Map<string, string>();
  for (const name of ["Website", "Walk-in", "Referral", "Social media"]) {
    const s = await db.leadSource.upsert({ where: { organizationId_name: { organizationId: org.id, name } }, create: { organizationId: org.id, name }, update: {} });
    sourceIds.set(name, s.id);
  }
  // AdmissionCampaign has no natural unique key: find-then-create.
  const campaign =
    (await db.admissionCampaign.findFirst({ where: { organizationId: org.id, name: "Admissions 2027-28", deletedAt: null } })) ??
    (await db.admissionCampaign.create({
      data: { organizationId: org.id, name: "Admissions 2027-28", channel: "SOCIAL", startDate: new Date(`${now.getFullYear()}-09-01T00:00:00.000Z`) },
    }));
  // Leads have no unique key either; match on (organization, normalized phone).
  const demoLeads: { name: string; phone: string; email?: string; stage: "NEW" | "CONTACTED" | "QUALIFIED" | "LOST"; source: string; campaign?: boolean; followUp?: string }[] = [
    { name: "Sunita Verma", phone: "9100000001", email: "sunita.verma@example.com", stage: "NEW", source: "Website", campaign: true },
    { name: "Mahesh Gupta", phone: "9100000002", stage: "CONTACTED", source: "Walk-in", followUp: `${now.getFullYear()}-09-14` },
    { name: "Farah Ali", phone: "9100000003", email: "farah.ali@example.com", stage: "QUALIFIED", source: "Referral", followUp: `${now.getFullYear()}-09-16` },
    { name: "Kiran Bose", phone: "9100000004", stage: "LOST", source: "Social media", campaign: true },
  ];
  const leadIds = new Map<string, string>();
  for (const l of demoLeads) {
    const lead =
      (await db.lead.findFirst({ where: { organizationId: org.id, phone: l.phone } })) ??
      (await db.lead.create({
        data: {
          organizationId: org.id,
          branchId: branch.id,
          sourceId: sourceIds.get(l.source)!,
          campaignId: l.campaign ? campaign.id : null,
          name: l.name,
          phone: l.phone,
          email: l.email ?? null,
          stage: l.stage,
          assignedCounselorUserId: orgAdmin.id,
          nextFollowUpAt: l.followUp ? new Date(`${l.followUp}T00:00:00.000Z`) : null,
        },
      }));
    leadIds.set(l.phone, lead.id);
  }
  // Farah's application is under review with one document still to verify.
  const farahId = leadIds.get("9100000003")!;
  const farahApp =
    (await db.application.findFirst({ where: { leadId: farahId } })) ??
    (await db.application.create({
      data: { leadId: farahId, applicantName: "Zara Ali", gradeAppliedFor: "Grade 2", status: "UNDER_REVIEW", submittedAt: new Date() },
    }));
  await db.lead.update({ where: { id: farahId }, data: { stage: "APPLIED" } });
  for (const [documentType, verified] of [["Birth certificate", true], ["Previous school report", true], ["Address proof", false]] as const) {
    if (!(await db.applicationDocument.findFirst({ where: { applicationId: farahApp.id, documentType } }))) {
      await db.applicationDocument.create({ data: { applicationId: farahApp.id, documentType, verified } });
    }
  }
  if (!(await db.appointment.findFirst({ where: { applicationId: farahApp.id } }))) {
    await db.appointment.create({ data: { applicationId: farahApp.id, type: "INTERVIEW", scheduledAt: new Date(`${now.getFullYear()}-09-18T10:30:00.000Z`) } });
  }

  console.log("Seeding demo finance...");
  const feeHeadIds = new Map<string, string>();
  for (const name of ["Tuition fee", "Books & uniform", "Transport fee"]) {
    const h = await db.feeHead.upsert({ where: { organizationId_name: { organizationId: org.id, name } }, create: { organizationId: org.id, name }, update: {} });
    feeHeadIds.set(name, h.id);
  }
  // One annual structure per grade for the current year; tuition rises with the grade.
  const gradesForFees = await db.grade.findMany({ where: { branchId: branch.id, deletedAt: null }, orderBy: { sequence: "asc" } });
  for (const g of gradesForFees) {
    const name = `${g.name} — Annual ${academicYear.name}`;
    const structure =
      (await db.feeStructure.findFirst({ where: { branchId: branch.id, academicYearId: academicYear.id, name, deletedAt: null } })) ??
      (await db.feeStructure.create({ data: { branchId: branch.id, academicYearId: academicYear.id, gradeId: g.id, name } }));
    const tuition = (25000 + 2000 * g.sequence).toFixed(2);
    for (const [head, amount] of [["Tuition fee", tuition], ["Books & uniform", "3500.00"]] as const) {
      await db.feeStructureLine.upsert({
        where: { feeStructureId_feeHeadId: { feeStructureId: structure.id, feeHeadId: feeHeadIds.get(head)! } },
        create: { feeStructureId: structure.id, feeHeadId: feeHeadIds.get(head)!, amount },
        update: {},
      });
    }
  }
  // Chart of accounts (mirrors ACCOUNT_CODES in src/modules/finance/money.ts).
  for (const [code, accName, type] of [["1000", "Cash", "ASSET"], ["1010", "Bank", "ASSET"], ["4000", "Fee income", "INCOME"]] as const) {
    await db.account.upsert({ where: { organizationId_code: { organizationId: org.id, code } }, create: { organizationId: org.id, code, name: accName, type }, update: {} });
  }

  console.log("Seeding demo LMS...");
  // One course per subject the demo teacher actually teaches, so the
  // gradebook and the attribute policy have something real to work with.
  const mathsCourse =
    (await db.course.findFirst({ where: { organizationId: org.id, title: "Mathematics — Grade 5", deletedAt: null } })) ??
    (await db.course.create({
      data: {
        organizationId: org.id,
        title: "Mathematics — Grade 5",
        description: "Number, fractions and early geometry for Grade 5.",
        subjectId: subjectIds.get("MAT")!,
        gradeId: gradesForFees.find((g) => g.name === "Grade 5")?.id ?? null,
      },
    }));
  let fractions = await db.courseModule.findFirst({ where: { courseId: mathsCourse.id, title: "Fractions" } });
  if (!fractions) {
    fractions = await db.courseModule.create({ data: { courseId: mathsCourse.id, title: "Fractions", sequence: 1 } });
    await db.lesson.createMany({
      data: [
        { courseModuleId: fractions.id, title: "Equivalent fractions", sequence: 1, content: "Same value, different numerator and denominator." },
        { courseModuleId: fractions.id, title: "Adding unlike fractions", sequence: 2, content: "Find a common denominator first." },
      ],
    });
  }

  const g5a = sectionIds.get("Grade 5|A")!;
  // A published assignment that is already partly graded, and a draft — the
  // two states the assignment screens need to show.
  let worksheet = await db.assignment.findFirst({ where: { courseId: mathsCourse.id, title: "Fractions worksheet 1" } });
  if (!worksheet) {
    worksheet = await db.assignment.create({
      data: {
        courseId: mathsCourse.id,
        sectionId: g5a,
        createdByStaffId: teacherStaff.id,
        title: "Fractions worksheet 1",
        instructions: "Questions 1–12 from the workbook.",
        dueAt: new Date(`${now.getFullYear()}-09-11T23:59:00.000Z`),
        maxMarks: 20,
        publishedAt: new Date(`${now.getFullYear()}-09-04T09:00:00.000Z`),
      },
    });
    const priya = await db.student.findFirst({ where: { organizationId: org.id, admissionNumber: "N-1001" } });
    if (priya) {
      await db.submission.create({
        data: {
          assignmentId: worksheet.id,
          studentId: priya.id,
          status: "GRADED",
          submittedAt: new Date(`${now.getFullYear()}-09-10T18:00:00.000Z`),
          marksAwarded: 17,
          feedback: "Neat work — watch the common denominators in Q9.",
          gradedAt: new Date(`${now.getFullYear()}-09-12T10:00:00.000Z`),
          gradedByStaffId: teacherStaff.id,
        },
      });
    }
  }
  if (!(await db.assignment.findFirst({ where: { courseId: mathsCourse.id, title: "Fractions quiz (draft)" } }))) {
    await db.assignment.create({
      data: {
        courseId: mathsCourse.id,
        sectionId: g5a,
        createdByStaffId: teacherStaff.id,
        title: "Fractions quiz (draft)",
        dueAt: new Date(`${now.getFullYear()}-09-25T23:59:00.000Z`),
        maxMarks: 10,
      },
    });
  }

  console.log("Seeding feature flags...");
  // Phase 1 shipped, so SIS defaults on. An organization can still switch it
  // off with a FeatureFlagOverride — that's what the flag is for.
  await db.featureFlag.upsert({
    where: { key: "phase1.sis" },
    create: { key: "phase1.sis", description: "Student Information System module (Phase 1)", defaultEnabled: true },
    update: { defaultEnabled: true },
  });
  await db.featureFlag.upsert({
    where: { key: "phase2.academics" },
    create: { key: "phase2.academics", description: "Academics: subjects, teaching assignments, timetable, attendance (Phase 2)", defaultEnabled: true },
    update: { defaultEnabled: true },
  });
  await db.featureFlag.upsert({
    where: { key: "phase3.admissions" },
    create: { key: "phase3.admissions", description: "Admissions CRM: leads, applications, public enquiry form (Phase 3)", defaultEnabled: true },
    update: { defaultEnabled: true },
  });
  await db.featureFlag.upsert({
    where: { key: "phase4.finance" },
    create: { key: "phase4.finance", description: "Finance: fee structures, invoices, payments & receipts, refunds, ledger (Phase 4)", defaultEnabled: true },
    update: { defaultEnabled: true },
  });
  await db.featureFlag.upsert({
    where: { key: "phase5.lms" },
    create: { key: "phase5.lms", description: "Learning: courses, assignments, grading, gradebook (Phase 5)", defaultEnabled: true },
    update: { defaultEnabled: true },
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
  console.log("  teacher@nalanda-demo.local / ChangeMe!123      (Teacher, Nalanda Main Campus — Grade 5 A and Grade 3 B only)");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
