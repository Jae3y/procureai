/**
 * Errors the domain raises on purpose. Routes render `userMessage` and `status`; anything that is
 * not a DomainError or a KoraError is a bug and becomes a 500 with a correlation id.
 */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly userMessage: string,
    readonly status: number = 409,
    readonly details?: Record<string, unknown>,
  ) {
    super(`${code}: ${userMessage}`);
    this.name = "DomainError";
  }
}

export class NotFoundError extends DomainError {
  constructor(what: string) {
    super("not_found", `${what} was not found.`, 404);
  }
}

/** A Kora reference we have not (yet) recorded. The outbox retries; the poller never sees it. */
export class UnknownReferenceError extends Error {
  constructor(readonly reference: string) {
    super(`no ProcureAI record for Kora reference ${reference} (yet)`);
    this.name = "UnknownReferenceError";
  }
}
