import type { Band } from "@/modules/reporting/grading-scale";

/**
 * A grading scale typed as text, one band per line:
 *
 *   A1 91 Outstanding
 *   A2, 81, Excellent
 *   E 0
 *
 * A textarea is the honest UI for this: a school copying its scale from the
 * board's circular wants to paste eight lines, not click "add band" eight
 * times. Every problem is reported with its line number rather than the
 * first one only, so a pasted scale is fixed in one pass.
 */
export type BandInputResult = { ok: true; bands: Band[] } | { ok: false; errors: string[] };

export const MAX_BANDS = 20;

export function parseBandLines(text: string): BandInputResult {
  const bands: Band[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((raw, i) => {
    // A band with no description pasted as "E, 0," still means "E, 0".
    const line = raw.trim().replace(/[\s,]+$/, "");
    if (line === "") return;
    const n = i + 1;
    // "label minPercent description…" with commas or spaces between the first two.
    const m = /^([^\s,]{1,12})[\s,]+(-?\d+(?:\.\d+)?)%?(?:[\s,]+(.+))?$/.exec(line);
    if (!m) {
      errors.push(`Line ${n}: write it as "label, lowest %, description" — e.g. "A1, 91, Outstanding"`);
      return;
    }
    const minPercent = Number(m[2]);
    if (!Number.isInteger(minPercent) || minPercent < 0 || minPercent > 100) {
      errors.push(`Line ${n}: ${m[2]} isn't a whole percentage from 0 to 100`);
      return;
    }
    const description = m[3]?.trim().slice(0, 60) || null;
    bands.push({ label: m[1]!, minPercent, description });
  });

  if (bands.length > MAX_BANDS) errors.push(`A scale can have at most ${MAX_BANDS} bands`);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, bands };
}
