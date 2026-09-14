/**
 * The message template engine (blueprint section 13).
 *
 * The rule that shapes this file: "Template variables come from an approved
 * data context; never let arbitrary templates read unrestricted student
 * data." So a template cannot reach into an object graph — it may only use
 * variables from an explicit allow-list, and anything else is a render
 * error the author sees before sending, not a silent blank or, worse, a
 * leak of whatever happened to be on the object.
 *
 * Syntax is deliberately tiny: {{student.first_name}}. No expressions, no
 * conditionals, no loops, no property traversal.
 */

export const TEMPLATE_VARIABLES = {
  "student.first_name": "The student's first name",
  "student.full_name": "The student's full name",
  "student.admission_number": "Admission number",
  "student.section": "Grade and section, e.g. Grade 5 / A",
  "guardian.name": "The guardian's full name",
  "school.name": "The branch name",
  "organization.name": "The organization name",
  "date.today": "Today's date, yyyy-mm-dd",
  "attendance.date": "The date an absence refers to",
  "invoice.number": "Invoice number",
  "invoice.outstanding": "Amount still due, formatted",
  "invoice.due_date": "Invoice due date",
} as const;

export type TemplateVariable = keyof typeof TEMPLATE_VARIABLES;

export const TEMPLATE_VARIABLE_KEYS = Object.keys(TEMPLATE_VARIABLES) as TemplateVariable[];

export function isTemplateVariable(name: string): name is TemplateVariable {
  return Object.prototype.hasOwnProperty.call(TEMPLATE_VARIABLES, name);
}

/** A rendering context: only allow-listed keys, all plain strings. */
export type TemplateContext = Partial<Record<TemplateVariable, string>>;

const PLACEHOLDER = /\{\{\s*([a-z0-9_.]+)\s*\}\}/gi;

/** Every placeholder used by a template, in first-seen order. */
export function extractVariables(body: string): string[] {
  const seen: string[] = [];
  for (const m of body.matchAll(PLACEHOLDER)) {
    const name = m[1].toLowerCase();
    if (!seen.includes(name)) seen.push(name);
  }
  return seen;
}

/** Placeholders that aren't on the allow-list — a template with any of these can't be saved. */
export function unknownVariables(body: string): string[] {
  return extractVariables(body).filter((v) => !isTemplateVariable(v));
}

export interface RenderResult {
  text: string;
  /** Allow-listed variables the context didn't supply a value for. */
  missing: string[];
}

/**
 * Substitutes allow-listed placeholders. An unknown placeholder is left
 * verbatim (it should have been rejected at save time); an allow-listed one
 * with no value is reported in `missing` and rendered as an empty string, so
 * a half-filled message is visible rather than shipped with "undefined" in
 * it.
 */
export function render(body: string, context: TemplateContext): RenderResult {
  const missing: string[] = [];
  const text = body.replace(PLACEHOLDER, (whole, rawName: string) => {
    const name = rawName.toLowerCase();
    if (!isTemplateVariable(name)) return whole;
    const value = context[name];
    if (value === undefined || value === "") {
      if (!missing.includes(name)) missing.push(name);
      return "";
    }
    return value;
  });
  return { text, missing };
}

/** SMS is billed per segment; the author should see the cost before sending. */
export function smsSegments(text: string): number {
  if (text.length === 0) return 0;
  // GSM-7 fits 160 per segment (153 when concatenated); anything outside it
  // forces UCS-2 at 70 (67 concatenated). Detecting the exact GSM-7 set is
  // overkill here — non-ASCII is the practical trigger.
  const unicode = /[^\x00-\x7F]/.test(text);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  return text.length <= single ? 1 : Math.ceil(text.length / multi);
}
