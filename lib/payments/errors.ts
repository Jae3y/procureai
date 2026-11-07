/**
 * What a payment provider's failure means for money, whoever the provider is.
 *
 * `outcomeKnown` is the split that matters: true means the provider definitely did not act (a
 * refusal), false means we can't know (timeout, 5xx, malformed reply), so a payout must stay
 * PENDING and be settled by asking the provider again, never by sending it again under a new
 * reference.
 *
 * `kind` uses one vocabulary across providers. The money path depends on: duplicate_reference,
 * not_found, insufficient_funds, auth, access. Each adapter maps its own errors onto these.
 */
export type ProviderId = "kora";

export abstract class ProviderError extends Error {
  abstract readonly provider: ProviderId;
  abstract readonly kind: string;
  abstract readonly outcomeKnown: boolean;
  /** One sentence a buyer, vendor or admin can read. */
  abstract get userMessage(): string;
  /** The provider's own words, when it gave any. */
  abstract get providerMessage(): string | undefined;
  /** The provider's response body, kept for the audit trail. */
  abstract readonly body: unknown;
  abstract toJSON(): Record<string, unknown>;
}

export function isProviderError(e: unknown): e is ProviderError {
  return e instanceof ProviderError;
}
