import "server-only";
import type { MessageChannel } from "@/generated/prisma/enums";

/**
 * Provider abstraction (blueprint section 6: "keep external integrations
 * behind adapters"; section 13: "a Notification Service with provider
 * adapters: Email, SMS, WhatsApp, Push, Voice").
 *
 * Only one adapter ships today, and it does NOT deliver anything: it
 * records what would have been sent so the whole pipeline — audience,
 * consent, quiet hours, rendering, delivery log, audit — is exercised and
 * reviewable without credentials. Wiring a real gateway means implementing
 * this interface and selecting it in `getProvider`; nothing above this file
 * changes.
 *
 * Deliberately not faked as success-with-a-real-looking-id: a recorded
 * message is labelled `recorded` in the delivery log, so nobody can mistake
 * a dev run for messages parents actually received.
 */

export interface OutboundMessage {
  channel: MessageChannel;
  to: string;
  subject: string | null;
  body: string;
}

export interface SendResult {
  status: "SENT" | "FAILED";
  providerMessageId?: string;
  failureReason?: string;
}

export interface MessageProvider {
  /** Shown in the delivery log so the operator knows what handled it. */
  readonly name: string;
  /** True only for an adapter that really hands the message to a carrier. */
  readonly delivers: boolean;
  supports(channel: MessageChannel): boolean;
  send(message: OutboundMessage): Promise<SendResult>;
}

/** Records the message and reports it as recorded, never as delivered. */
class RecordingProvider implements MessageProvider {
  readonly name = "recorded";
  readonly delivers = false;

  /** Recording works for every channel precisely because it delivers none. */
  supports(): boolean {
    return true;
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    // Length is the interesting part in logs; the body is already stored on
    // the Message row, so don't duplicate parent contact details into stdout.
    console.info(`[connect] recorded ${message.channel} to ${maskAddress(message.to)} (${message.body.length} chars)`);
    return { status: "SENT", providerMessageId: `rec_${crypto.randomUUID()}` };
  }
}

/** Enough to identify a recipient in a log line without printing the whole number. */
export function maskAddress(address: string): string {
  const at = address.indexOf("@");
  if (at > 0) return `${address.slice(0, 2)}***${address.slice(at)}`;
  return address.length <= 4 ? "***" : `***${address.slice(-4)}`;
}

// Typed as the interface, not the class, so callers see the full contract
// (and a narrower implementation can't quietly change what callers may pass).
const recording: MessageProvider = new RecordingProvider();

/**
 * Returns the adapter for a channel. When a real provider is configured it
 * is selected here; until then everything is recorded.
 */
export function getProvider(channel: MessageChannel): MessageProvider {
  const provider = recording;
  if (!provider.supports(channel)) throw new Error(`No provider is configured for ${channel}`);
  return provider;
}

export function hasDeliveringProvider(): boolean {
  return getProvider("SMS").delivers;
}
