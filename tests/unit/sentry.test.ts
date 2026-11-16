import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { buildEvent, framesFrom, parseDsn, redactPath, reportError, sentryEnabled } from "@/lib/notify/sentry";

const DSN = "https://abc123publickey@o4501.ingest.sentry.io/4507";

function setDsn(v: string) {
  process.env.SENTRY_DSN = v;
  resetEnvCache();
}

afterEach(() => setDsn(""));

describe("Sentry error reports", () => {
  it("reads a DSN into the envelope address and key, and refuses anything else", () => {
    expect(parseDsn(DSN)).toEqual({ endpoint: "https://o4501.ingest.sentry.io/api/4507/envelope/", publicKey: "abc123publickey", raw: DSN });
    expect(parseDsn("")).toBeNull();
    expect(parseDsn("not a url")).toBeNull();
    expect(parseDsn("http://key@o1.ingest.sentry.io/1")).toBeNull(); // not https
    expect(parseDsn("https://o1.ingest.sentry.io/1")).toBeNull(); // no key
  });

  it("is off, and sends nothing, until SENTRY_DSN is set", async () => {
    const fetchImpl = vi.fn();
    expect(sentryEnabled()).toBe(false);
    expect(await reportError(new Error("boom"), { where: "test" }, fetchImpl as unknown as typeof fetch)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends one envelope with the error, where it happened and the correlation id", async () => {
    setDsn(DSN);
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(await reportError(new TypeError("cannot read x"), { where: "route:auth.signup", correlationId: "cid-1" }, fetchImpl as unknown as typeof fetch)).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://o4501.ingest.sentry.io/api/4507/envelope/");
    expect(String((init.headers as Record<string, string>)["X-Sentry-Auth"])).toContain("sentry_key=abc123publickey");
    const [header, item, event] = String(init.body).split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(header?.dsn).toBe(DSN);
    expect(item).toEqual({ type: "event" });
    expect(event?.tags).toEqual({ where: "route:auth.signup", correlation_id: "cid-1" });
    expect(JSON.stringify(event?.exception)).toContain("cannot read x");
  });

  it("never throws, even when Sentry is down", async () => {
    setDsn(DSN);
    const down = vi.fn(async () => {
      throw new Error("network down");
    });
    await expect(reportError(new Error("boom"), { where: "test" }, down as unknown as typeof fetch)).resolves.toBe(false);
  });

  it("turns a stack into frames, oldest call first, marking library code", () => {
    const stack = "Error: x\n    at inner (/app/lib/a.ts:10:5)\n    at outer (/app/node_modules/next/b.js:20:7)\n    at /app/lib/c.ts:3:1";
    expect(framesFrom(stack)).toEqual([
      { filename: "/app/lib/c.ts", lineno: 3, colno: 1, in_app: true },
      { function: "outer", filename: "/app/node_modules/next/b.js", lineno: 20, colno: 7, in_app: false },
      { function: "inner", filename: "/app/lib/a.ts", lineno: 10, colno: 5, in_app: true },
    ]);
  });

  it("keeps secret links out of reports", () => {
    expect(redactPath("/v/SPk7bRFD2BB33TYE3NrpAqN_xXe5akGR")).toBe("/v/[link]");
    expect(redactPath("/r/cmwj2rosr.j_o4QPoklK5f5c9e7zUzAY")).toBe("/r/[link]");
    expect(redactPath("/orders/abc123/receipt")).toBe("/orders/[id]/receipt");
    expect(redactPath("/market")).toBe("/market");
    expect(buildEvent("a string", { where: "x" }).exception.values[0]?.value).toBe("a string");
  });
});
