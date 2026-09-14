/**
 * Phone numbers as typed by parents and counselors vary wildly ("+91 90000
 * 00001", "090000-00001", "9000000001"). Everything that compares phones
 * goes through here so two modules can't disagree about what "the same
 * number" means — de-duplicating leads (blueprint 10.5), reusing a sibling's
 * guardian, and the guardian picker.
 */

/** Digits only; a country code is dropped when what remains is a 10-digit national number. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length > 10 && digits.length <= 13) return digits.slice(-10);
  return digits;
}

export function isPlausiblePhone(normalized: string): boolean {
  return normalized.length >= 7 && normalized.length <= 15;
}

/**
 * A Prisma string filter that finds stored phones equal to this one, however
 * either side was formatted. Full-number `endsWith` — never a shorter
 * substring: the demo data alone has 9000000003 and 9100000003, which share
 * their last eight digits and are different families.
 */
export function phoneMatchFilter(raw: string): { endsWith: string } | { equals: string } | null {
  const n = normalizePhone(raw);
  if (!isPlausiblePhone(n)) return null;
  return n.length >= 10 ? { endsWith: n } : { equals: n };
}
