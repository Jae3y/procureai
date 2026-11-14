import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { ALERT_EVERY_MS, alertOwner } from "@/lib/notify/alerts";

let sent: Array<{ to: string[]; subject: string }> = [];

beforeEach(() => {
  sent = [];
  Object.assign(process.env, { RESEND_API_KEY: "re_test_key", OPS_ALERT_EMAIL: "owner@example.com" });
  resetEnvCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body));
      return new Response("{}", { status: 200 });
    }),
  );
});
afterEach(() => {
  Object.assign(process.env, { RESEND_API_KEY: "", OPS_ALERT_EMAIL: "" });
  resetEnvCache();
  vi.unstubAllGlobals();
});

describe("owner alerts", () => {
  it("emails the owner, at most once an hour for the same problem", async () => {
    const key = `test-${Date.now()}`;
    const t0 = new Date();
    expect(await alertOwner(key, "Something broke", ["detail"], t0)).toBe(true);
    expect(await alertOwner(key, "Something broke", ["detail"], new Date(t0.getTime() + 60_000))).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: ["owner@example.com"], subject: "ProcureAI alert: Something broke" });
    expect(await alertOwner(key, "Something broke", ["detail"], new Date(t0.getTime() + ALERT_EVERY_MS + 1_000))).toBe(true);
    expect(sent).toHaveLength(2);
  });

  it("different problems are separate", async () => {
    const t = new Date();
    expect(await alertOwner(`a-${Date.now()}`, "A", [], t)).toBe(true);
    expect(await alertOwner(`b-${Date.now()}`, "B", [], t)).toBe(true);
  });

  it("does nothing without an alert address", async () => {
    Object.assign(process.env, { OPS_ALERT_EMAIL: "" });
    resetEnvCache();
    expect(await alertOwner(`c-${Date.now()}`, "C", [])).toBe(false);
    expect(sent).toHaveLength(0);
  });
});
