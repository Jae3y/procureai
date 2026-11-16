import { describe, expect, it } from "vitest";
import { GET as sample } from "@/app/sample/route";
import { db } from "@/lib/db";
import { setSetting } from "@/lib/domain/settings";
import { fundOrder, makeOrderFixture, moveOrder } from "../helpers/factories";

/** "See a completed record" opens ONE fixed record, not whoever finished last. */

async function completeOrder() {
  const f = await makeOrderFixture({ amountKobo: 84_000_000n });
  await fundOrder(f.order.id, f.order.amountKobo);
  await moveOrder(f.order.id, ["STAGE_1_PAID", "CODE_VERIFIED", "RELEASED", "COMPLETE"]);
  return db().order.findUniqueOrThrow({ where: { id: f.order.id } });
}

const location = async () => (await sample()).headers.get("location") ?? "";

describe("/sample", () => {
  it("always opens the pinned completed order, even when a newer one finishes", async () => {
    const pinned = await completeOrder();
    await setSetting("sampleOrderId", pinned.id);
    await completeOrder(); // a newer completed purchase must not take over
    expect(await location()).toContain(`/r/${pinned.id}.`);
  });

  it("falls back to the newest completed demo order when nothing valid is pinned", async () => {
    await setSetting("sampleOrderId", "does-not-exist");
    const newest = await completeOrder();
    await db().request.update({ where: { id: newest.requestId }, data: { isDemo: true } });
    expect(await location()).toContain(`/r/${newest.id}.`);
  });

  it("never picks a real customer's record by itself: it names the buyer and the vendors", async () => {
    await setSetting("sampleOrderId", "does-not-exist");
    const real = await completeOrder();
    await db().request.update({ where: { id: real.requestId }, data: { isDemo: false } });
    const where = await location();
    expect(where).not.toContain(real.id);
    expect(where).toMatch(/\/buy$/);
  });
});
