import { describe, expect, it } from "vitest";
import { POST as emailsPost } from "@/app/api/account/emails/route";
import { db } from "@/lib/db";
import { signUp } from "@/lib/domain/accounts";
import { accountSessionCookie } from "@/lib/http/session";
import { dueLifecycleEmails } from "@/lib/notify/lifecycle";

async function post(cookie: string, body: unknown) {
  return emailsPost(
    new Request("http://localhost:3000/api/account/emails", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie }, body: JSON.stringify(body) }),
    { params: Promise.resolve({}) },
  );
}

describe("email choices on the account page", () => {
  it("turns check-ins and tips on and off; turning check-ins off also turns tips off", async () => {
    const a = await signUp({ name: "Ada Obi", email: "choices@example.com", password: "a long and unusual passphrase" });
    const cookie = (accountSessionCookie(a).split(";")[0] ?? "");

    expect((await post(cookie, { checkins: true, tips: true })).status).toBe(200);
    let row = await db().account.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.marketingConsentAt).not.toBeNull();
    expect(row.emailsOffAt).toBeNull();

    await post(cookie, { checkins: false, tips: true });
    row = await db().account.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.emailsOffAt).not.toBeNull();
    expect(row.marketingConsentAt).toBeNull();
    expect((await dueLifecycleEmails(new Date())).some((d) => d.account.id === a.id)).toBe(false);

    await post(cookie, { checkins: true, tips: false });
    row = await db().account.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.emailsOffAt).toBeNull();
    expect(row.marketingConsentAt).toBeNull();
  });

  it("needs a signed-in account", async () => {
    expect((await post("", { checkins: false, tips: false })).status).toBe(401);
  });
});
