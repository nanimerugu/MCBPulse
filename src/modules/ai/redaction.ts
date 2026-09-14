/**
 * Redaction — what must never leave the building.
 *
 * The moment a prompt goes to a third-party model, every identifier in it
 * has left the school's control: it may be logged by the provider, retained,
 * or used for training. A school's data protection duty does not pause
 * because the feature is called AI.
 *
 * So the gateway redacts before it sends, and this module is that rule in
 * one testable place. It replaces identifiers with stable placeholders
 * (`[STUDENT_1]`, not `[REDACTED]`) so the model can still reason about
 * "the first student" and the caller can put the real names back afterwards.
 *
 * This is a safety net, NOT a licence to send student records to a model.
 * Capabilities declare what they may read (see capabilities.ts); redaction
 * is the second line, for names that slip through in free text a teacher
 * typed.
 */

export interface RedactionResult {
  text: string;
  /** placeholder -> original, for restoring the model's answer. */
  map: Map<string, string>;
  counts: Record<RedactedKind, number>;
}

export type RedactedKind = "name" | "phone" | "email" | "admission_number" | "employee_code";

const EMPTY_COUNTS: Record<RedactedKind, number> = { name: 0, phone: 0, email: 0, admission_number: 0, employee_code: 0 };

// Indian mobile numbers and the general 10-15 digit shape, with optional
// country code and common separators.
const PHONE = /(?:\+?\d{1,3}[\s-]?)?\b\d{10,15}\b/g;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
// N-1001 / T-100 / A-200 style codes used by the seed and by real schools.
const ADMISSION = /\b[A-Z]{1,3}-\d{3,6}\b/g;

function placeholder(kind: RedactedKind, n: number): string {
  return `[${kind.toUpperCase()}_${n}]`;
}

/**
 * Redacts free text. `knownNames` are the people this caller could plausibly
 * be writing about — passing the whole student roster would be both slow and
 * pointless, so callers pass the names in scope (a section's students, say).
 *
 * Order matters: emails contain things that look like names, and phone
 * numbers contain things that look like admission numbers, so the most
 * specific patterns run first.
 */
export function redact(text: string, knownNames: readonly string[] = []): RedactionResult {
  const map = new Map<string, string>();
  const counts = { ...EMPTY_COUNTS };
  let out = text;

  const replaceAll = (pattern: RegExp, kind: RedactedKind) => {
    out = out.replace(pattern, (match) => {
      for (const [ph, original] of map) if (original === match) return ph;
      counts[kind] += 1;
      const ph = placeholder(kind, counts[kind]);
      map.set(ph, match);
      return ph;
    });
  };

  replaceAll(EMAIL, "email");
  replaceAll(PHONE, "phone");
  replaceAll(ADMISSION, "admission_number");

  // Names last and longest-first, so "Priya Rao" is replaced as one unit
  // rather than leaving a stray "Rao" behind.
  const names = [...new Set(knownNames.filter((n) => n.trim().length > 2))].sort((a, b) => b.length - a.length);
  for (const name of names) {
    const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, "gi");
    if (!pattern.test(out)) continue;
    counts.name += 1;
    const ph = placeholder("name", counts.name);
    map.set(ph, name);
    out = out.replace(pattern, ph);
  }

  return { text: out, map, counts };
}

/** Puts the real values back into a model's answer. */
export function restore(text: string, map: ReadonlyMap<string, string>): string {
  let out = text;
  for (const [ph, original] of map) out = out.split(ph).join(original);
  return out;
}

export function totalRedactions(counts: Record<RedactedKind, number>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
