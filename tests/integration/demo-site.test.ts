import { afterEach, describe, expect, it } from "vitest";
import { GET as demoGet } from "@/app/demo/route";
import { resetEnvCache } from "@/lib/env";

afterEach(() => {
  Object.assign(process.env, { DEMO_MODE: "true", DEMO_SITE_URL: "" });
  resetEnvCache();
});

describe("the real site sends demo visitors to the separate demo site", () => {
  it("with demo mode off and a demo site set, /demo redirects there", async () => {
    Object.assign(process.env, { DEMO_MODE: "false", ADMIN_TOKEN: "an-admin-token-of-24-chars-min", DEMO_SITE_URL: "https://demo.procureai.com.ng" });
    resetEnvCache();
    const res = await demoGet(new Request("https://procureai.com.ng/demo"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://demo.procureai.com.ng/demo");
    Object.assign(process.env, { ADMIN_TOKEN: "" });
  });

  it("with demo mode off and no demo site, /demo is simply not found", async () => {
    Object.assign(process.env, { DEMO_MODE: "false", ADMIN_TOKEN: "an-admin-token-of-24-chars-min", DEMO_SITE_URL: "" });
    resetEnvCache();
    expect((await demoGet(new Request("https://procureai.com.ng/demo"))).status).toBe(404);
    Object.assign(process.env, { ADMIN_TOKEN: "" });
  });

  it("ignores a demo address that isn't a plain https site", async () => {
    Object.assign(process.env, { DEMO_MODE: "false", ADMIN_TOKEN: "an-admin-token-of-24-chars-min", DEMO_SITE_URL: "javascript:alert(1)" });
    resetEnvCache();
    expect((await demoGet(new Request("https://procureai.com.ng/demo"))).status).toBe(404);
    Object.assign(process.env, { ADMIN_TOKEN: "" });
  });
});
