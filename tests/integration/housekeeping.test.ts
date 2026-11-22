import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { signUp } from "@/lib/domain/accounts";
import { pruneHousekeeping } from "@/lib/worker/housekeeping";
import { useKoraDouble } from "../helpers/kora";

useKoraDouble();

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms);

describe("housekeeping cleanup", () => {
  it("removes only dead rate counters, old stored replies and long-expired tokens", async () => {
    const account = await signUp({ name: "Ada Obi", email: "keep@example.com", password: "a long unusual passphrase" });
    await db().rateLimit.createMany({
      data: [
        { key: "hk:old", windowStart: ago(2 * DAY), count: 3 },
        { key: "hk:live", windowStart: ago(30 * 60_000), count: 3 },
      ],
    });
    await db().idempotencyKey.createMany({
      data: [
        { key: "hk:old-reply", route: "test", requestHash: "x", createdAt: ago(8 * DAY) },
        { key: "hk:new-reply", route: "test", requestHash: "y", createdAt: ago(HOUR) },
      ],
    });
    await db().accountToken.createMany({
      data: [
        { accountId: account.id, purpose: "reset", tokenHash: "hk-dead", expiresAt: ago(8 * DAY) },
        { accountId: account.id, purpose: "reset", tokenHash: "hk-recently-expired", expiresAt: ago(DAY) },
        { accountId: account.id, purpose: "reset", tokenHash: "hk-valid", expiresAt: new Date(Date.now() + HOUR) },
      ],
    });

    const report = await pruneHousekeeping();

    expect(report.rateLimits).toBeGreaterThanOrEqual(1);
    expect(await db().rateLimit.findUnique({ where: { key: "hk:old" } })).toBeNull();
    expect(await db().rateLimit.findUnique({ where: { key: "hk:live" } })).not.toBeNull();
    expect(await db().idempotencyKey.findUnique({ where: { key: "hk:old-reply" } })).toBeNull();
    expect(await db().idempotencyKey.findUnique({ where: { key: "hk:new-reply" } })).not.toBeNull();
    const tokens = (await db().accountToken.findMany({ where: { tokenHash: { startsWith: "hk-" } } })).map((t) => t.tokenHash).sort();
    expect(tokens).toEqual(["hk-recently-expired", "hk-valid"]);
    expect(await db().account.findUnique({ where: { id: account.id } })).not.toBeNull();
  });
});
