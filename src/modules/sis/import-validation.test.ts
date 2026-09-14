import { describe, expect, it } from "vitest";
import { normalizeHeader, validateStudentImport, type ImportContext } from "@/modules/sis/import-validation";

const ctx: ImportContext = {
  existingAdmissionNumbers: new Set(["N-0001"]),
  sections: [
    { id: "sec-5a", name: "A", gradeName: "Grade 5" },
    { id: "sec-5b", name: "B", gradeName: "Grade 5" },
  ],
};

function run(headers: string[], rows: string[][]) {
  const records = rows.map((cells) => Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""])));
  return validateStudentImport(headers, records, ctx);
}

describe("normalizeHeader", () => {
  it("maps the messy headers people actually type", () => {
    expect(normalizeHeader("Admission No.")).toBe("admission_number");
    expect(normalizeHeader("First Name")).toBe("first_name");
    expect(normalizeHeader("DOB")).toBe("date_of_birth");
    expect(normalizeHeader("Class")).toBe("grade");
    expect(normalizeHeader("Parent Phone")).toBe("guardian_phone");
    expect(normalizeHeader("Shoe size")).toBeNull();
  });
});

describe("validateStudentImport", () => {
  it("accepts a clean row and resolves its section", () => {
    const r = run(
      ["Admission No", "First Name", "Last Name", "DOB", "Grade", "Section", "Parent Name", "Parent Phone", "Relation"],
      [["N-0002", "Priya", "Rao", "2015-06-01", "Grade 5", "A", "Anil Rao", "9000000001", "Father"]],
    );
    expect(r.errorCount).toBe(0);
    expect(r.validCount).toBe(1);
    expect(r.rows[0].parsed).toMatchObject({
      admissionNumber: "N-0002",
      firstName: "Priya",
      dateOfBirth: "2015-06-01",
      sectionId: "sec-5a",
      guardian: { name: "Anil Rao", phone: "9000000001", relationship: "FATHER" },
    });
  });

  it("fails every row when a required column is missing entirely", () => {
    const r = run(["First Name", "Last Name"], [["Priya", "Rao"]]);
    expect(r.missingRequired).toEqual(["admission_number"]);
    expect(r.rows[0].errors[0]).toMatch(/Missing required column/);
    expect(r.validCount).toBe(0);
  });

  it("flags an admission number that already exists in the database", () => {
    const r = run(["admission_number", "first_name", "last_name"], [["N-0001", "Dup", "Licate"]]);
    expect(r.rows[0].errors).toEqual(['admission_number "N-0001" already exists']);
  });

  it("flags a duplicate admission number within the file on the later row only", () => {
    const r = run(
      ["admission_number", "first_name", "last_name"],
      [
        ["N-0009", "A", "One"],
        ["n-0009", "B", "Two"],
      ],
    );
    expect(r.rows[0].errors).toEqual([]);
    expect(r.rows[1].errors[0]).toMatch(/Duplicate admission_number/);
    expect(r.validCount).toBe(1);
  });

  it("rejects an unknown section and a half-specified one", () => {
    const r = run(
      ["admission_number", "first_name", "last_name", "grade", "section"],
      [
        ["N-0010", "A", "One", "Grade 5", "Z"],
        ["N-0011", "B", "Two", "Grade 5", ""],
      ],
    );
    expect(r.rows[0].errors[0]).toMatch(/No section "Z" in grade "Grade 5"/);
    expect(r.rows[1].errors[0]).toMatch(/grade and section must be given together/);
  });

  it("rejects a malformed or impossible date of birth", () => {
    const r = run(
      ["admission_number", "first_name", "last_name", "date_of_birth"],
      [
        ["N-0012", "A", "One", "01/06/2015"],
        ["N-0013", "B", "Two", "2015-02-30"],
      ],
    );
    expect(r.rows[0].errors[0]).toMatch(/must be yyyy-mm-dd/);
    expect(r.rows[1].errors[0]).toMatch(/must be yyyy-mm-dd/);
  });

  it("requires name and phone once any guardian column is filled", () => {
    const r = run(
      ["admission_number", "first_name", "last_name", "guardian_email"],
      [["N-0014", "A", "One", "x@example.com"]],
    );
    expect(r.rows[0].errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/guardian_name is required/), expect.stringMatching(/guardian_phone is required/)]),
    );
  });

  it("collects several problems on the same row instead of stopping at the first", () => {
    const r = run(["admission_number", "first_name", "last_name", "date_of_birth"], [["", "", "Rao", "nope"]]);
    expect(r.rows[0].errors.length).toBe(3);
    expect(r.rows[0].parsed).toBeNull();
  });
});
