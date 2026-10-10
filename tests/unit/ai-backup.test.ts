import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { AiUnavailableError, chatJson, setAiFetchForTests } from "@/lib/ai/client";
import { humanizeDates } from "@/lib/ai/dates";
import { resetEnvCache } from "@/lib/env";

const schema = z.object({ answer: z.string() });
const ask = () => chatJson({ task: "t", system: "s", user: "u", schema });
const ok = () => new Response(JSON.stringify({ model: "backup-model", choices: [{ message: { content: '{"answer":"ok"}' } }] }), { status: 200 });

const saved = { ...process.env };
function configure(vars: Record<string, string>) {
  Object.assign(process.env, { AI_API_KEY: "primary-key", AI_BACKUP_API_KEY: "", ...vars });
  resetEnvCache();
}

beforeEach(() => configure({}));
afterEach(() => {
  setAiFetchForTests(undefined);
  process.env = { ...saved };
  resetEnvCache();
});

describe("backup AI provider", () => {
  it("is asked when the primary is unavailable, and its answer is used", async () => {
    configure({ AI_BACKUP_API_KEY: "backup-key" });
    const hosts: string[] = [];
    setAiFetchForTests(async (url) => {
      hosts.push(new URL(url).hostname);
      return new URL(url).hostname === "api.groq.com" ? ok() : new Response("gone", { status: 404 });
    });
    const r = await ask();
    expect(r.data.answer).toBe("ok");
    expect(hosts).toEqual(["generativelanguage.googleapis.com", "api.groq.com"]);
  });

  it("is not asked when the primary answers", async () => {
    configure({ AI_BACKUP_API_KEY: "backup-key" });
    const hosts: string[] = [];
    setAiFetchForTests(async (url) => {
      hosts.push(new URL(url).hostname);
      return ok();
    });
    await ask();
    expect(hosts).toEqual(["generativelanguage.googleapis.com"]);
  });

  it("without a backup key the failure still surfaces for the rules fallback", async () => {
    setAiFetchForTests(async () => new Response("gone", { status: 404 }));
    await expect(ask()).rejects.toBeInstanceOf(AiUnavailableError);
  });
});

describe("AI request lanes", () => {
  it("never runs more than two calls to one provider at the same time", async () => {
    let active = 0;
    let peak = 0;
    setAiFetchForTests(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 40));
      active -= 1;
      return ok();
    });
    const results = await Promise.all(Array.from({ length: 6 }, () => ask()));
    expect(results.every((r) => r.data.answer === "ok")).toBe(true);
    expect(peak).toBe(2);
  });
});

describe("dates in AI reasoning", () => {
  it("reads like a person wrote it", () => {
    expect(humanizeDates("can deliver by 2026-10-15.")).toBe("can deliver by 15 October.");
    expect(humanizeDates("ready 2026‑10‑08, before 2026-10-20")).toBe("ready 8 October, before 20 October");
    expect(humanizeDates("order 2026-13-40 stays")).toBe("order 2026-13-40 stays");
  });
});
