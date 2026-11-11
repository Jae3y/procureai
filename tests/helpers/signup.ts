/** A complete, valid sign-up body, filled in "ten seconds ago" the way a person would. */
export function signupBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    firstName: "Ada",
    lastName: "Obi",
    email: `ada+${Date.now()}${Math.floor(Math.random() * 1e6)}@example.com`,
    phone: "0803 123 4567",
    password: "a long unusual passphrase",
    intent: "BUY",
    marketingOptIn: false,
    acceptTerms: true,
    openedAt: Date.now() - 10_000,
    ...overrides,
  };
}
