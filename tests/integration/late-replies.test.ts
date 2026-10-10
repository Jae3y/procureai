import { describe, expect, it } from "vitest";
import { inviteTokenFor } from "@/lib/crypto";
import { db } from "@/lib/db";
import { DEMO_VENDORS } from "@/lib/demo/script";
import { recommend } from "@/lib/domain/recommend";
import { createRequest, inviteVendors } from "@/lib/domain/requests";
import { verifyVendors } from "@/lib/domain/verification";
import { submitQuote } from "@/lib/domain/vendors";
import { buildRequestView } from "@/lib/views/request-view";
import { makeBuyer } from "../helpers/factories";
import { useKoraDouble } from "../helpers/kora";

useKoraDouble();

const ask = { item: "Cartons of noodles", quantity: 40, budgetKobo: 60_000_000n };

async function reply(requestId: string, label: string, businessName: string) {
  const v = DEMO_VENDORS.find((d) => d.businessName === businessName)!;
  await submitQuote(inviteTokenFor(requestId, label), {
    reply: v.reply(ask) ?? "",
    businessName: v.businessName,
    rcNumber: v.rcNumber,
    bankCode: v.bankCode,
    accountNumber: v.accountNumber,
    email: v.email,
    consent: true,
  });
}

describe("Quotes and Decision agree", () => {
  it("the Decision list shows what was checked; later replies are counted, not left 'Checking…'", async () => {
    await db().vendorContact.deleteMany();
    const buyer = await makeBuyer();
    const request = await createRequest({ rawText: "40 cartons of noodles, under ₦600k, delivered by 20 October", buyerId: buyer.id });
    const invites = await inviteVendors(request.id);
    const byName = (n: string) => invites.find((i) => i.businessName === n)!;

    await reply(request.id, byName("Kwik Supplies").label, "Kwik Supplies");
    await reply(request.id, byName("Imole Wholesale Ltd").label, "Imole Wholesale Ltd");
    await verifyVendors(request.id);
    // Scripted and real replies keep arriving while Kora is checking: this one lands before the ranking.
    await reply(request.id, byName("Mile 12 Bulk Provisions").label, "Mile 12 Bulk Provisions");
    await recommend(request.id);

    const v = await buildRequestView(request.id, { includeInvites: false });
    expect(v.repliedCount).toBe(3);
    expect(v.checks).toHaveLength(2);
    expect(v.checks.every((c) => c.verdict !== "UNCHECKED")).toBe(true);
    expect(v.lateReplies).toBe(1);

    await verifyVendors(request.id);
    await recommend(request.id);
    const after = await buildRequestView(request.id, { includeInvites: false });
    expect(after.checks).toHaveLength(3);
    expect(after.lateReplies).toBe(0);
  });
});
