import { env } from "@/lib/env";
import type { ProviderId } from "./errors";
import { koraProvider } from "./kora";
import type { PaymentProvider } from "./provider";

/**
 * Which provider handles what.
 *   payments()        — the provider for NEW money movements (PAYMENT_PROVIDER, default Kora).
 *   providerFor(id)   — the provider an EXISTING payment belongs to. A charge is always checked, and
 *                       a payment always refunded, through the provider that took it, even after the
 *                       default changes.
 * Adding a provider: write lib/payments/<name>.ts implementing PaymentProvider, add it below and to
 * ProviderId, give it a webhook route that calls the same reconcile functions, and make it pass
 * tests/integration/payment-provider-contract.test.ts against its sandbox.
 */

const PROVIDERS: Record<ProviderId, PaymentProvider> = { kora: koraProvider };

export function providerFor(id: string): PaymentProvider {
  const p = PROVIDERS[id as ProviderId];
  if (!p) throw new Error(`Unknown payment provider "${id}" on a stored payment`);
  return p;
}

export function payments(): PaymentProvider {
  return providerFor(env().PAYMENT_PROVIDER);
}

export { isProviderError, ProviderError, type ProviderId } from "./errors";
export type * from "./provider";
