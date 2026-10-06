/**
 * Typed Kora failures. Every error carries what the UI needs to say something true and readable,
 * plus what an engineer needs to find the call in the logs (correlationId, endpoint, httpStatus).
 *
 * The split that matters for money: `outcomeKnown`. A 4xx means Kora refused — nothing happened.
 * A timeout, network error, 5xx or a malformed 2xx means we do NOT know whether Kora acted, so a
 * payout must stay PENDING and be resolved by querying, never by retrying with a new reference.
 */

export type KoraErrorInit = {
  endpoint: string;
  correlationId: string;
  httpStatus?: number | undefined;
  koraMessage?: string | undefined;
  koraCode?: string | undefined;
  body?: unknown;
};

export abstract class KoraError extends Error {
  abstract readonly kind: string;
  /** True when Kora definitely did not perform the action. */
  abstract readonly outcomeKnown: boolean;
  readonly endpoint: string;
  readonly correlationId: string;
  readonly httpStatus: number | undefined;
  readonly koraMessage: string | undefined;
  readonly koraCode: string | undefined;
  readonly body: unknown;

  constructor(message: string, init: KoraErrorInit) {
    super(message);
    this.name = new.target.name;
    this.endpoint = init.endpoint;
    this.correlationId = init.correlationId;
    this.httpStatus = init.httpStatus;
    this.koraMessage = init.koraMessage;
    this.koraCode = init.koraCode;
    this.body = init.body;
  }

  /** One sentence a buyer, vendor or admin can read. */
  abstract get userMessage(): string;

  toJSON() {
    return {
      kind: this.kind,
      message: this.userMessage,
      endpoint: this.endpoint,
      httpStatus: this.httpStatus ?? null,
      koraMessage: this.koraMessage ?? null,
      koraCode: this.koraCode ?? null,
      correlationId: this.correlationId,
    };
  }
}

export class KoraAuthError extends KoraError {
  readonly kind = "auth";
  readonly outcomeKnown = true;
  get userMessage() {
    return "Kora rejected our API key. Check KORA_SECRET_KEY is the current test-mode secret key.";
  }
}

export class KoraAccessError extends KoraError {
  readonly kind = "access";
  readonly outcomeKnown = true;
  get userMessage() {
    return `This Kora account cannot use ${this.endpoint} yet${
      this.koraMessage ? ` (Kora: "${this.koraMessage}")` : ""
    }. Ask Kora support to enable it.`;
  }
}

export class KoraValidationError extends KoraError {
  readonly kind: string = "validation";
  readonly outcomeKnown = true;
  get userMessage() {
    return this.koraMessage ? `Kora refused the request: ${this.koraMessage}.` : "Kora refused the request as invalid.";
  }
}

export class KoraNotFoundError extends KoraValidationError {
  override readonly kind = "not_found";
  override get userMessage() {
    return this.koraMessage ? `Kora: ${this.koraMessage}.` : "Kora has no record of that.";
  }
}

export class KoraDuplicateReferenceError extends KoraValidationError {
  override readonly kind = "duplicate_reference";
  override get userMessage() {
    return "Kora already has a transaction with this reference.";
  }
}

export class KoraInsufficientFundsError extends KoraValidationError {
  override readonly kind = "insufficient_funds";
  override get userMessage() {
    return "Insufficient funds in disbursement wallet. Top up the Kora balance, then retry this payout.";
  }
}

export class KoraServerError extends KoraError {
  readonly kind = "server";
  readonly outcomeKnown = false;
  get userMessage() {
    return `Kora is having trouble right now (HTTP ${this.httpStatus ?? "5xx"}). Nothing is lost; we'll confirm the result with Kora.`;
  }
}

export class KoraTimeoutError extends KoraError {
  readonly kind = "timeout";
  readonly outcomeKnown = false;
  get userMessage() {
    return "Kora didn't answer in time. Nothing is lost; we'll confirm the result with Kora.";
  }
}

/** A 2xx whose body did not match Kora's documented shape. Outcome unknown by definition. */
export class KoraSchemaError extends KoraError {
  readonly kind = "schema";
  readonly outcomeKnown = false;
  constructor(
    message: string,
    init: KoraErrorInit,
    readonly issues: string[],
  ) {
    super(message, init);
  }
  get userMessage() {
    return "Kora answered in an unexpected format. We'll confirm the result with Kora before doing anything else.";
  }
}

export function isKoraError(e: unknown): e is KoraError {
  return e instanceof KoraError;
}
