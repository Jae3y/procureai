import { createSign, generateKeyPairSync, type JsonWebKey } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GoogleSignInError, verifyGoogleIdToken } from "@/lib/auth/google";

/** Our own RSA key stands in for Google's; the verifier is given it the way it would fetch Google's. */
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: "jwk" }) as JsonWebKey), kid: "test-key" };
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });

const CLIENT_ID = "procureai-test.apps.googleusercontent.com";
const NOW = 1_800_000_000;
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

function token(claims: Record<string, unknown>, opts: { kid?: string; alg?: string; key?: typeof privateKey } = {}): string {
  const header = b64({ alg: opts.alg ?? "RS256", kid: opts.kid ?? "test-key", typ: "JWT" });
  const payload = b64({
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    sub: "1234567890",
    email: "Ada@Example.com",
    email_verified: true,
    name: "Ada Obi",
    nonce: "n-123",
    iat: NOW - 10,
    exp: NOW + 3600,
    ...claims,
  });
  const sig = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(opts.key ?? privateKey).toString("base64url");
  return `${header}.${payload}.${sig}`;
}

const verify = (t: string, nonce = "n-123") =>
  verifyGoogleIdToken(t, { nonce, clientId: CLIENT_ID, nowS: NOW, getKey: async (kid) => (kid === "test-key" ? jwk : null) });

async function refusal(p: Promise<unknown>): Promise<string> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(GoogleSignInError);
  return (err as GoogleSignInError).reason;
}

describe("Google ID token verification", () => {
  it("accepts a valid token and returns who it's for, email lower-cased", async () => {
    expect(await verify(token({}))).toEqual({ sub: "1234567890", email: "ada@example.com", name: "Ada Obi" });
  });

  it("refuses a token for another app", async () => {
    expect(await refusal(verify(token({ aud: "someone-else.apps.googleusercontent.com" })))).toBe("token is for another app");
  });

  it("refuses an expired token", async () => {
    expect(await refusal(verify(token({ exp: NOW - 3600 })))).toBe("token expired");
  });

  it("refuses a token from a different sign-in attempt (nonce)", async () => {
    expect(await refusal(verify(token({}), "another-nonce"))).toBe("nonce mismatch");
  });

  it("refuses an email Google hasn't verified", async () => {
    expect(await refusal(verify(token({ email_verified: false })))).toBe("Google hasn't verified this email");
  });

  it("refuses a token from another issuer", async () => {
    expect(await refusal(verify(token({ iss: "https://evil.example" })))).toBe("wrong issuer");
  });

  it("refuses a token whose contents were changed after signing", async () => {
    const [h, , s] = token({}).split(".");
    const forged = `${h}.${b64({ iss: "https://accounts.google.com", aud: CLIENT_ID, sub: "attacker", email: "victim@example.com", email_verified: true, nonce: "n-123", exp: NOW + 3600 })}.${s}`;
    expect(await refusal(verify(forged))).toBe("bad signature");
  });

  it("refuses a token signed with a key that isn't Google's", async () => {
    expect(await refusal(verify(token({}, { key: other.privateKey })))).toBe("bad signature");
  });

  it("refuses an unknown key id and any algorithm other than RS256", async () => {
    expect(await refusal(verify(token({}, { kid: "unknown" })))).toBe("unknown signing key");
    expect(await refusal(verify(token({}, { alg: "none" })))).toBe("unexpected signing algorithm");
  });
});
