import type { MessageChannel } from "@/generated/prisma/enums";

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
 */
export function isWithinQuietHours(at: Date, quiet: QuietHours | null): boolean {
  if (!quiet) return false;
  const start = toMinutes(quiet.start);
  const end = toMinutes(quiet.end);
  if (start === null || end === null) return false;
  const t = at.getUTCHours() * 60 + at.getUTCMinutes();
  return start <= end ? t >= start && t < end : t >= start || t < end;
}

/** The first moment at or after `at` that isn't inside quiet hours. */
export function nextSendableAt(at: Date, quiet: QuietHours | null): Date {
  if (!isWithinQuietHours(at, quiet) || !quiet) return at;
  const end = toMinutes(quiet.end);
  if (end === null) return at;
  const out = new Date(at);
  out.setUTCSeconds(0, 0);
  out.setUTCHours(Math.floor(end / 60), end % 60);
  // Wrapped window and we're still in the late-evening part: the window ends tomorrow.
  if (out.getTime() <= at.getTime()) out.setUTCDate(out.getUTCDate() + 1);
  return out;
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
