import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as unsubscribePost } from "@/app/api/unsubscribe/route";
import { db } from "@/lib/db";
import { signUp } from "@/lib/domain/accounts";
import { resetEnvCache } from "@/lib/env";
import { dueLifecycleEmails, MARKETING_GAP_DAYS, runLifecycle, unsubscribe, unsubscribeUrl } from "@/lib/notify/lifecycle";

const DAY = 86_400_000;
const PASSWORD = "a long and unusual passphrase";
let n = 0;
let sent: Array<{ to: string[]; subject: string; headers?: Record<string, string>; text: string }> = [];

beforeEach(() => {
  sent = [];
  Object.assign(process.env, { RESEND_API_KEY: "re_test_key" });
  resetEnvCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: "x" }), { status: 200 });
    }),
  );
});
afterEach(() => {
  Object.assign(process.env, { RESEND_API_KEY: "" });
  resetEnvCache();
  vi.unstubAllGlobals();
});

async function person(opts: { consent?: boolean; ageDays?: number; loginDaysAgo?: number | null; intent?: string } = {}) {
  n += 1;
  const a = await signUp({ name: "Ada Obi", email: `life${n}@example.com`, password: PASSWORD, ...(opts.intent ? { intent: opts.intent as never } : {}) });
  return db().account.update({
    where: { id: a.id },
    data: {
      createdAt: new Date(Date.now() - (opts.ageDays ?? 3) * DAY),
      emailVerifiedAt: new Date(),
      marketingConsentAt: opts.consent ? new Date() : null,
      lastLoginAt: opts.loginDaysAgo === null ? null : new Date(Date.now() - (opts.loginDaysAgo ?? 1) * DAY),
    },
  });
}

/** Sign-up itself sends a "Confirm your email" message; these tests are about the lifecycle emails only. */
const lifecycleSent = (email?: string) => sent.filter((m) => !m.subject.startsWith("Confirm your email") && (!email || m.to[0] === email));

/** 8 a.m. Lagos = 07:00 UTC. */
const MORNING = () => {
  const d = new Date();
  d.setUTCHours(7, 0, 0, 0);
  return d;
};

describe("lifecycle emails", () => {
  it("sends a welcome once, even to someone who didn't tick the marketing box, and never again", async () => {
    const a = await person({ consent: false, ageDays: 1 });
    const r1 = await runLifecycle(MORNING(), { force: true });
    expect(r1.sent).toBeGreaterThanOrEqual(1);
    const mine = lifecycleSent(a.email);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.subject).toContain("Welcome to ProcureAI");
    await runLifecycle(MORNING(), { force: true });
    expect(lifecycleSent(a.email)).toHaveLength(1);
  });

  it("every email carries a one-click unsubscribe", async () => {
    const a = await person({ ageDays: 1 });
    await runLifecycle(MORNING(), { force: true });
    const m = lifecycleSent(a.email)[0];
    expect(m?.headers?.["List-Unsubscribe"]).toContain("/unsubscribe?t=");
    expect(m?.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(m?.text).toContain("/unsubscribe?t=");
  });

  it("sends nothing at night", async () => {
    await person({ ageDays: 1 });
    const night = new Date();
    night.setUTCHours(22, 0, 0, 0); // 11 p.m. Lagos
    expect(await runLifecycle(night)).toEqual({ sent: 0, skipped: 0 });
    expect(lifecycleSent()).toHaveLength(0);
  });

  it("marketing goes only to people who ticked the box, at most one a week, and not after they unsubscribe", async () => {
    const yes = await person({ consent: true, ageDays: 40, loginDaysAgo: 1 });
    const no = await person({ consent: false, ageDays: 40, loginDaysAgo: 1 });
    const due = await dueLifecycleEmails(new Date());
    expect(due.some((d) => d.account.id === yes.id && d.draft.kind === "tip")).toBe(true);
    expect(due.some((d) => d.account.id === no.id)).toBe(false);

    await runLifecycle(MORNING(), { force: true });
    expect(lifecycleSent(yes.email)).toHaveLength(1);
    // Next pass, a day later: the weekly gap blocks another marketing email.
    const later = new Date(MORNING().getTime() + DAY);
    expect((await dueLifecycleEmails(later)).some((d) => d.account.id === yes.id)).toBe(false);
    // After the gap, a month's tip has already been sent, so still nothing until next month.
    const afterGap = new Date(MORNING().getTime() + (MARKETING_GAP_DAYS + 1) * DAY);
    expect((await dueLifecycleEmails(afterGap)).filter((d) => d.account.id === yes.id && d.draft.kind === "tip")).toHaveLength(0);

    expect(await unsubscribe(unsubscribeUrl(yes.id).split("t=")[1] ? decodeURIComponent(unsubscribeUrl(yes.id).split("t=")[1] ?? "") : "")).toBe(true);
    const after = await db().account.findUniqueOrThrow({ where: { id: yes.id } });
    expect(after).toMatchObject({ marketingConsentAt: null });
    expect(after.emailsOffAt).not.toBeNull();
  });

  it("a quiet, consenting person gets a warm hello after 60 days away, once a quarter", async () => {
    const a = await person({ consent: true, ageDays: 120, loginDaysAgo: 75 });
    const due = await dueLifecycleEmails(new Date());
    expect(due.find((d) => d.account.id === a.id)?.draft.kind).toBe("hello");
    await runLifecycle(MORNING(), { force: true });
    const m = lifecycleSent(a.email)[0];
    expect(m?.subject).toBe("Hope you're doing well");
    expect((await dueLifecycleEmails(new Date(MORNING().getTime() + 10 * DAY))).some((d) => d.account.id === a.id && d.draft.kind === "hello")).toBe(false);
  });

  it("someone who unsubscribed gets no lifecycle email of any kind", async () => {
    const a = await person({ consent: true, ageDays: 1 });
    await db().account.update({ where: { id: a.id }, data: { emailsOffAt: new Date(), marketingConsentAt: null } });
    expect((await dueLifecycleEmails(new Date())).some((d) => d.account.id === a.id)).toBe(false);
  });

  it("an altered or foreign unsubscribe link does nothing; the real one works through the endpoint", async () => {
    const a = await person({ consent: true });
    const token = decodeURIComponent(unsubscribeUrl(a.id).split("t=")[1] ?? "");
    const bad = await unsubscribePost(new Request(`http://localhost:3000/api/unsubscribe?t=${encodeURIComponent(token.slice(0, -2) + "xx")}`, { method: "POST" }));
    expect(bad.status).toBe(400);
    expect((await db().account.findUniqueOrThrow({ where: { id: a.id } })).marketingConsentAt).not.toBeNull();
    const ok = await unsubscribePost(new Request(`http://localhost:3000/api/unsubscribe?t=${encodeURIComponent(token)}`, { method: "POST" }));
    expect(ok.status).toBe(200);
    expect((await db().account.findUniqueOrThrow({ where: { id: a.id } })).marketingConsentAt).toBeNull();
  });

  it("without an email key nothing is sent and nothing is recorded", async () => {
    Object.assign(process.env, { RESEND_API_KEY: "" });
    resetEnvCache();
    const a = await person({ ageDays: 1 });
    expect(await runLifecycle(MORNING(), { force: true })).toEqual({ sent: 0, skipped: 0 });
    expect(await db().lifecycleEmail.count({ where: { accountId: a.id } })).toBe(0);
  });
});
