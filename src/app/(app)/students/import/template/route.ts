import { auth } from "@/lib/auth";
import { toCsv } from "@/modules/sis/csv";
import { IMPORT_COLUMNS } from "@/modules/sis/import-validation";

/** The CSV the import expects — headers plus one example row. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

  const csv = toCsv([
    [...IMPORT_COLUMNS],
    ["N-2001", "Aarav", "Sharma", "2016-03-14", "M", "Grade 4", "A", "Rahul Sharma", "9000000099", "rahul@example.com", "FATHER"],
  ]);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="mcbpulse-students-template.csv"',
    },
  });
}
