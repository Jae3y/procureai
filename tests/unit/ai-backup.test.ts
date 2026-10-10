import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { AiUnavailableError, chatJson, setAiFetchForTests } from "@/lib/ai/client";
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
