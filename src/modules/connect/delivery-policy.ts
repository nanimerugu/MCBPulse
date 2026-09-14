import type { MessageChannel } from "@/generated/prisma/enums";
import { minutesOfDay } from "@/lib/time-zone";

/**
 * Who may be contacted, on which channel, and when (blueprint section 13:
 * "support consent, quiet hours, opt-out, channel fallback and rate
 * limits"). Pure so the rules are testable and so the send path and the
 * preview agree about who would actually receive a message.
 */

export interface Recipient {
  /** Stable id for de-duplication — a guardian of two children is one person. */
  key: string;
  name: string;
  address: string;
  channel: MessageChannel;
  optedOut: boolean;
}

export type SuppressionReason = "opted_out" | "no_address" | "duplicate";

export interface DeliveryPlan {
  send: Recipient[];
  suppressed: { recipient: Recipient; reason: SuppressionReason }[];
}

/**
 * Removes people who can't or shouldn't be contacted, and collapses
 * duplicates. Suppressions are returned rather than silently dropped: a
 * principal sending to 400 guardians deserves to know that 12 were skipped
 * and why.
 */
export function planDelivery(recipients: readonly Recipient[]): DeliveryPlan {
  const send: Recipient[] = [];
  const suppressed: DeliveryPlan["suppressed"] = [];
  const seen = new Set<string>();

  for (const r of recipients) {
    if (!r.address.trim()) {
      suppressed.push({ recipient: r, reason: "no_address" });
      continue;
    }
    if (r.optedOut) {
      suppressed.push({ recipient: r, reason: "opted_out" });
      continue;
    }
    const dedupeKey = `${r.channel}:${r.address.trim().toLowerCase()}`;
    if (seen.has(dedupeKey)) {
      suppressed.push({ recipient: r, reason: "duplicate" });
      continue;
    }
    seen.add(dedupeKey);
    send.push(r);
  }

  return { send, suppressed };
}

export const SUPPRESSION_LABELS: Record<SuppressionReason, string> = {
  opted_out: "Opted out of this channel",
  no_address: "No phone or email on record",
  duplicate: "Same address already in this send",
};

/** "HH:mm" -> minutes since midnight, or null if malformed. */
export function toMinutes(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export interface QuietHours {
  /** e.g. "21:00" */
  start: string;
  /** e.g. "07:00" — a window that wraps midnight is normal and supported. */
  end: string;
}

/**
 * Quiet hours are a school's promise not to text parents at 3am. A window
 * whose end is before its start wraps midnight (21:00–07:00), which is the
 * common case and the one a naive `start <= t && t < end` gets wrong.
 *
 * The window is read on the SCHOOL'S clock. It used to be read in UTC, which
 * put an Indian school's "21:00–07:00" at 02:30–12:30 local time — silencing
 * the school morning and texting families at 9pm. The zone defaults to UTC
 * only so the pure tests can state their instants plainly; every caller in
 * the application passes the branch's zone.
 */
export function isWithinQuietHours(at: Date, quiet: QuietHours | null, timeZone = "UTC"): boolean {
  if (!quiet) return false;
  const start = toMinutes(quiet.start);
  const end = toMinutes(quiet.end);
  if (start === null || end === null) return false;
  const t = minutesOfDay(at, timeZone);
  return start <= end ? t >= start && t < end : t >= start || t < end;
}

/**
 * The first moment at or after `at` that isn't inside quiet hours.
 *
 * Counted as minutes forward to the end of the window rather than by
 * setting the hour on a Date, so it works on any clock without having to
 * know the zone's offset. (Across a daylight-saving change it can land an
 * hour off; for the zones this runs in there is none.)
 */
export function nextSendableAt(at: Date, quiet: QuietHours | null, timeZone = "UTC"): Date {
  if (!quiet || !isWithinQuietHours(at, quiet, timeZone)) return at;
  const end = toMinutes(quiet.end);
  if (end === null) return at;
  const minutesToEnd = (end - minutesOfDay(at, timeZone) + 1440) % 1440;
  const startOfMinute = Math.floor(at.getTime() / 60_000) * 60_000;
  return new Date(startOfMinute + minutesToEnd * 60_000);
}

export const CHANNEL_LABELS: Record<MessageChannel, string> = {
  SMS: "SMS",
  EMAIL: "Email",
  WHATSAPP: "WhatsApp",
  PUSH: "Push",
  VOICE: "Voice",
};

/** Which contact detail a channel needs. */
export function addressKindFor(channel: MessageChannel): "phone" | "email" {
  return channel === "EMAIL" ? "email" : "phone";
}

export interface GuardianNotifyOutcome {
  queued: number;
  sent: number;
  /** Who was not contacted and why — opted out, no number on file, duplicate. */
  suppressed: { name: string; reason: string }[];
  guardiansOnRecord: number;
  moduleOff?: boolean;
  failed?: boolean;
}

/**
 * Plain-English account of an urgent notification that reached nobody.
 * Returns null when at least one guardian was contacted.
 *
 * This exists because "recorded" and "the parent knows" are different facts,
 * and a caller that conflates them is the dangerous case: a nurse who sends a
 * feverish child home believing the family was told, when the only guardian
 * on file had opted out of SMS months ago.
 */
export function unreachedWarning(outcome: GuardianNotifyOutcome): string | null {
  if (outcome.queued > 0) return null;
  if (outcome.moduleOff) return "No guardian was contacted — the Communication module is switched off for this organization. Telephone them.";
  if (outcome.failed) return "No guardian was contacted — the notification system errored. Telephone them.";
  if (outcome.guardiansOnRecord === 0) return "No guardian was contacted — this student has no guardian linked to their record. Telephone the family.";
  const why = outcome.suppressed.map((s) => `${s.name} — ${s.reason.toLowerCase()}`).join("; ");
  return `No guardian was contacted${why ? `: ${why}` : ""}. Telephone them.`;
}
