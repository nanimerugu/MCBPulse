import "server-only";
import type { BuiltPrompt } from "@/modules/ai/prompt";
import { estimateTokens } from "@/modules/ai/prompt";

/**
 * The AI Gateway's provider seam (blueprint §7: "Keep AI behind an AI
 * Gateway", §21 rule 14). Everything above this line is the school's; a
 * model vendor plugs in below it.
 *
 * Same shape and same honesty as Connect's provider abstraction: no key is
 * configured here, so the shipped adapter DOES NOT GENERATE ANYTHING. It
 * returns a clearly-marked placeholder and records the usage that a real
 * call would have produced. Every other part of the pipeline — permission
 * check, redaction, fencing, accounting, audit — runs for real, so the day a
 * key is added the only thing that changes is the adapter.
 */

export interface AiCompletion {
  text: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  /** False for the recording adapter: nothing was actually generated. */
  generated: boolean;
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  readonly generates: boolean;
  complete(prompt: BuiltPrompt): Promise<AiCompletion>;
}

class RecordingProvider implements AiProvider {
  readonly name = "recorded";
  readonly model = "none";
  readonly generates = false;

  async complete(prompt: BuiltPrompt): Promise<AiCompletion> {
    const tokensIn = estimateTokens(prompt.system) + estimateTokens(prompt.user);
    const text = [
      "No AI provider is configured, so nothing was generated.",
      "",
      "Everything else in the pipeline ran: your permission was checked, identifiers were redacted, school data was fenced as untrusted, and this attempt was recorded with its token estimate.",
      "",
      `Estimated prompt size: ${tokensIn} tokens.`,
      "",
      "To make this real, implement AiProvider in src/modules/ai/providers.ts and return it from getAiProvider().",
    ].join("\n");
    return { text, tokensIn, tokensOut: estimateTokens(text), costUsd: null, generated: false };
  }
}

const recording: AiProvider = new RecordingProvider();

export function getAiProvider(): AiProvider {
  return recording;
}

export function hasGeneratingProvider(): boolean {
  return getAiProvider().generates;
}
