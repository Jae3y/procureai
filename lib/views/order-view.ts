import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/domain/errors";
import { revealHandoverCode } from "@/lib/domain/handover";
import { bankLabel } from "@/lib/domain/payin";
import { env } from "@/lib/env";
import type { OrderStatus, Payout, PayoutStage } from "@/lib/generated/prisma/client";
import { signRecordId } from "@/lib/crypto";
import { formatNaira, splitStages } from "@/lib/money";
import { itemPhrase, lagosDay, lagosTime, longOrderRef, orderRef, spacedAccount, spacedCode } from "./format";
import type { KoraRow } from "./request-view";

/**
 * Everything the pay screen, the tracker and the vendor's phone render for one order. The Money
 * Trail is derived from what Kora has CONFIRMED — payout and pay-in statuses — never from timers,
 * so the line only extends when money moves.
 */

export type Audience = "buyer" | "vendor" | "admin";
export type NodeState = "done" | "held" | "failed" | "pending";
export type TrailNode = { key: string; label: string; amount: string; stamp: string | null; state: NodeState };

export type OrderView = {
  id: string;
  ref: string;
  longRef: string;
  status: OrderStatus;
  itemLine: string;
  vendorLabel: string;
  vendorName: string;
  buyerName: string;
  amount: string;
  stage1Amount: string;
  stage2Amount: string;
  screen: "pay" | "track";
  pay: {
    state: "opening" | "open" | "short" | "paid" | "expired";
    amountDue: string;
    accountNumber: string | null;
    bankName: string | null;
    accountName: string | null;
    expiresAt: string | null;
    reference: string | null;
    checkoutUrl: string | null;
    shortfall: string | null;
    heldSoFar: string | null;
    paidStamp: { amount: string; reference: string; time: string } | null;
    overpaid: string | null;
  };
  track: {
    title: string;
    titleTone: "ink" | "red";
    nodes: TrailNode[];
    step: number;
    held: { amount: string; tone: "amber" | "green" };
    code: string | null;
    failure: { stage: string; title: string; detail: string; reference: string; canRetry: boolean } | null;
    blocked: { title: string; detail: string } | null;
    pendingNote: string | null;
    complete: boolean;
    disputed: { title: string; detail: string; refund: string | null } | null;
    recordPath: string | null;
  };
  vendor: {
    screen: "waiting" | "stage1" | "releasing" | "paid" | "disputed";
    stage1: { state: "pending" | "paid" | "failed"; reference: string | null };
    stage2: { state: "none" | "pending" | "paid" | "failed"; reference: string | null };
    codeAttemptsLeft: number;
    codeLocked: boolean;
    codeUsed: boolean;
    totalReceived: string;
  };
  events: KoraRow[];
  lastEventId: string;
  simulatedIdentity: boolean;
  sandboxRoute: string | null;
  testMode: boolean;
  demoMode: boolean;
};

function latestOf(payouts: Payout[], stage: PayoutStage): Payout | undefined {
  return payouts.filter((p) => p.stage === stage).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
}

function titleFor(status: OrderStatus, s1: Payout | undefined, s2: Payout | undefined, failedStage: string | null): { title: string; tone: "ink" | "red" } {
  switch (status) {
    case "HELD":
      return { title: "Held. Paying the vendor's 30%.", tone: "ink" };
    case "STAGE_1_PAID":
      return s1?.status === "SUCCESS" ? { title: "Stage 1 paid. Waiting for delivery.", tone: "ink" } : { title: "Held. Sending Stage 1.", tone: "ink" };
    case "CODE_VERIFIED":
    case "RELEASED":
      return s2?.status === "SUCCESS" ? { title: "Stage 2 paid.", tone: "ink" } : { title: "Delivery confirmed. Paying the rest.", tone: "ink" };
    case "COMPLETE":
      return { title: "Complete. Every naira accounted for.", tone: "ink" };
    case "PAYOUT_FAILED":
      return { title: `${failedStage ?? "Payout"} payout failed.`, tone: "red" };
    case "DISPUTED":
      return { title: "Disputed. Payouts are frozen.", tone: "red" };
    case "REFUNDED":
      return { title: "Refunded. Held money returned.", tone: "ink" };
    default:
      return { title: "Paid. Waiting for the vendor.", tone: "ink" };
  }
}

export async function buildOrderView(orderId: string, audience: Audience): Promise<OrderView> {
  const order = await db().order.findUnique({
    where: { id: orderId },
    include: {
      request: { include: { buyer: true } },
      vendor: true,
      payIns: { orderBy: { sequence: "asc" } },
      payouts: true,
      refunds: { orderBy: { createdAt: "desc" } },
      ledger: true,
    },
  });
  if (!order) throw new NotFoundError("Order");
  const [orderEvents, requestEvents] = await Promise.all([
    db().orderEvent.findMany({ where: { orderId }, orderBy: { id: "asc" } }),
    db().requestEvent.findMany({ where: { requestId: order.requestId, kind: "kora" }, orderBy: { id: "asc" } }),
  ]);
  const e = env();
  const { stage1, stage2 } = splitStages(order.amountKobo);
  const held = order.ledger
    .filter((l) => l.account === "HELD")
    .reduce((a, l) => a + (l.direction === "CREDIT" ? l.amountKobo : -l.amountKobo), 0n);
  const s1 = latestOf(order.payouts, "STAGE_1");
  const s2 = latestOf(order.payouts, "STAGE_2");
  const s1Paid = order.payouts.find((p) => p.stage === "STAGE_1" && p.status === "SUCCESS");
  const s2Paid = order.payouts.find((p) => p.stage === "STAGE_2" && p.status === "SUCCESS");
  const reachedHeld = order.amountAcceptedKobo >= order.amountKobo;
  const successPayIns = order.payIns.filter((p) => p.status === "SUCCESS");
  const firstPaid = successPayIns[0];
  const openPayIn = [...order.payIns].reverse().find((p) => p.status === "PROCESSING");
  const lastPayIn = order.payIns.at(-1);
  const failedStage =
    order.status === "PAYOUT_FAILED" ? (s2?.status === "FAILED" ? "Stage 2" : s1?.status === "FAILED" ? "Stage 1" : null) : null;
  const failedPayout = failedStage === "Stage 2" ? s2 : failedStage === "Stage 1" ? s1 : undefined;

  // ── pay screen ──
  const payState: OrderView["pay"]["state"] =
    order.status === "CREATED"
      ? "opening"
      : order.status === "UNDERPAID"
        ? "short"
        : order.status === "AWAITING_PAYMENT"
          ? openPayIn && (!openPayIn.expiresAt || openPayIn.expiresAt > new Date())
            ? "open"
            : "expired"
          : "paid";
  const shortfall = order.amountKobo > order.amountAcceptedKobo ? order.amountKobo - order.amountAcceptedKobo : 0n;
  const shown = openPayIn ?? lastPayIn;

  // ── trail ──
  const codeUsed = Boolean(order.codeUsedAt);
  const complete = order.status === "COMPLETE";
  const code = audience !== "vendor" && order.handoverCodeCipher ? revealHandoverCode(order) : null;
  const s1Failed = !s1Paid && s1?.status === "FAILED";
  const s2Failed = !s2Paid && s2?.status === "FAILED";
  const nodes: TrailNode[] = [
    {
      key: "paid",
      label: "Paid",
      amount: formatNaira(reachedHeld ? order.amountAcceptedKobo : order.amountKobo),
      stamp: firstPaid ? `KORA · ${firstPaid.reference}${successPayIns.length > 1 ? ` +${successPayIns.length - 1}` : ""}` : null,
      state: reachedHeld ? "done" : "pending",
    },
    {
      key: "held",
      label: "Held",
      amount: formatNaira(reachedHeld ? held : order.amountKobo),
      stamp: firstPaid?.accountNumber ? `KVA · ${spacedAccount(firstPaid.accountNumber)}` : null,
      state: reachedHeld ? (complete || order.status === "REFUNDED" ? "done" : "held") : "pending",
    },
    {
      key: "stage1",
      label: s1Failed ? "Stage 1 failed" : "Stage 1 paid",
      amount: formatNaira(stage1),
      stamp: s1Paid ? s1Paid.reference : s1Failed && s1 ? `${s1.reference} · Failed` : null,
      state: s1Paid ? "done" : s1Failed && order.status === "PAYOUT_FAILED" ? "failed" : "pending",
    },
    {
      key: "code",
      label: "Delivery code entered",
      amount: order.codeUsedAt ? lagosDay(order.codeUsedAt) : "",
      stamp: codeUsed ? (code ? `Code ${spacedCode(code)} ✓` : "Code ✓") : null,
      state: codeUsed ? "done" : "pending",
    },
    {
      key: "stage2",
      label: s2Failed ? "Stage 2 failed" : "Stage 2 paid",
      amount: formatNaira(stage2),
      stamp: s2Paid ? s2Paid.reference : s2Failed && s2 ? `${s2.reference} · Failed` : null,
      state: s2Paid ? "done" : s2Failed && order.status === "PAYOUT_FAILED" ? "failed" : "pending",
    },
    {
      key: "complete",
      label: "Complete",
      amount: "",
      stamp: complete ? longOrderRef(order.number, order.createdAt) : null,
      state: complete ? "done" : "pending",
    },
  ];
  let step = -1;
  for (const [i, n] of nodes.entries()) {
    if (n.state === "done" || n.state === "held") step = i;
    else break;
  }

  // Latest error/info after the last state change explains a pause (unfunded balance, unknown outcome…).
  const lastStateId = [...orderEvents].reverse().find((ev) => ev.kind === "state")?.id ?? 0n;
  const sinceState = orderEvents.filter((ev) => ev.id > lastStateId);
  const lastError = [...sinceState].reverse().find((ev) => ev.kind === "error" && ev.title.endsWith("not sent"));
  const pendingInfo = [...sinceState].reverse().find((ev) => ev.kind === "info" && ev.title.startsWith("Checking"));

  const t = titleFor(order.status, s1, s2, failedStage);
  const refund = order.refunds[0];
  const disputeEvent = [...orderEvents].reverse().find((ev) => ev.title === "Disputed");

  // ── Kora events panel ──
  const visible = (sig: string | null) => audience === "admin" || sig !== "INVALID";
  const rows: KoraRow[] = [
    ...requestEvents.map((ev) => ({
      id: `r${ev.id.toString()}`,
      time: lagosTime(ev.createdAt),
      name: ev.title,
      amount: "",
      detail: ev.detail ?? "",
      ref: ev.koraReference ?? "",
      signature: (ev.signature as KoraRow["signature"]) ?? null,
    })),
    ...orderEvents
      .filter((ev) => (ev.kind === "kora" || (ev.kind === "info" && ev.koraReference)) && visible(ev.signature))
      .map((ev) => ({
        id: ev.id.toString(),
        time: lagosTime(ev.createdAt),
        name: ev.kind === "kora" ? ev.title : ev.title,
        amount: ev.amountKobo !== null ? formatNaira(ev.amountKobo) : "",
        detail: ev.detail ?? "",
        ref: ev.koraReference ?? "",
        signature: (ev.signature as KoraRow["signature"]) ?? null,
      })),
  ];

  const routeNote = order.payouts.find((p) => p.route === "SANDBOX_TEST_ACCOUNT");
  const vendorScreen: OrderView["vendor"]["screen"] =
    order.status === "COMPLETE"
      ? "paid"
      : order.status === "DISPUTED" || order.status === "REFUNDED"
        ? "disputed"
        : order.status === "CODE_VERIFIED" || order.status === "RELEASED" || (order.status === "PAYOUT_FAILED" && failedStage === "Stage 2")
          ? "releasing"
          : order.status === "STAGE_1_PAID" || order.status === "HELD" || order.status === "PAYOUT_FAILED"
            ? "stage1"
            : "waiting";

  return {
    id: order.id,
    ref: orderRef(order.number),
    longRef: longOrderRef(order.number, order.createdAt),
    status: order.status,
    itemLine: itemPhrase(order.request.quantity, order.request.item),
    vendorLabel: order.vendor.label,
    vendorName: order.vendor.name ?? order.vendor.label,
    buyerName: order.request.buyer.name,
    amount: formatNaira(order.amountKobo),
    stage1Amount: formatNaira(stage1),
    stage2Amount: formatNaira(stage2),
    screen: ["CREATED", "AWAITING_PAYMENT", "UNDERPAID"].includes(order.status) ? "pay" : "track",
    pay: {
      state: payState,
      amountDue: formatNaira(payState === "short" ? shortfall : (shown?.amountExpectedKobo ?? order.amountKobo)),
      accountNumber: spacedAccount(shown?.accountNumber),
      bankName: shown?.bankName ? bankLabel(shown.bankName) : null,
      accountName: shown?.accountName ?? null,
      expiresAt: shown?.expiresAt?.toISOString() ?? null,
      reference: shown?.reference ?? null,
      checkoutUrl: shown?.checkoutUrl ?? null,
      shortfall: shortfall > 0n ? formatNaira(shortfall) : null,
      heldSoFar: order.amountAcceptedKobo > 0n ? formatNaira(order.amountAcceptedKobo) : null,
      paidStamp:
        reachedHeld && firstPaid
          ? { amount: formatNaira(order.amountAcceptedKobo), reference: firstPaid.reference, time: lagosTime(successPayIns.at(-1)?.creditedAt ?? firstPaid.createdAt) }
          : null,
      overpaid: order.amountAcceptedKobo > order.amountKobo ? formatNaira(order.amountAcceptedKobo - order.amountKobo) : null,
    },
    track: {
      title: t.title,
      titleTone: t.tone,
      nodes,
      step,
      held: { amount: formatNaira(held), tone: held === 0n || complete ? "green" : "amber" },
      code: code && !codeUsed && order.status !== "DISPUTED" && order.status !== "REFUNDED" ? spacedCode(code) : null,
      failure:
        failedStage && failedPayout
          ? {
              stage: failedStage,
              title: `${failedStage} payout failed.`,
              detail: `${failedPayout.failureReason ?? "The vendor's bank declined the transfer"}. ${formatNaira(failedPayout.amountKobo)} is still held and has not left the account.`,
              reference: failedPayout.reference,
              canRetry: audience !== "vendor",
            }
          : null,
      blocked: lastError ? { title: lastError.title, detail: lastError.detail ?? "" } : null,
      pendingNote: pendingInfo?.detail ?? null,
      complete,
      disputed:
        order.status === "DISPUTED" || order.status === "REFUNDED"
          ? {
              title: order.status === "REFUNDED" ? "Refunded." : "Disputed.",
              detail: disputeEvent?.detail ?? "Payouts are frozen while this is resolved.",
              refund: refund ? `${formatNaira(refund.amountKobo)} · ${refund.status.toLowerCase()} · ${refund.reference}` : null,
            }
          : null,
      recordPath: `/r/${signRecordId(order.id)}`,
    },
    vendor: {
      screen: vendorScreen,
      stage1: { state: s1Paid ? "paid" : s1?.status === "FAILED" ? "failed" : "pending", reference: (s1Paid ?? s1)?.reference ?? null },
      stage2: { state: s2Paid ? "paid" : !s2 ? "none" : s2.status === "FAILED" ? "failed" : "pending", reference: (s2Paid ?? s2)?.reference ?? null },
      codeAttemptsLeft: Math.max(0, 5 - order.codeAttempts),
      codeLocked: order.codeAttempts >= 5,
      codeUsed,
      totalReceived: formatNaira(order.payouts.filter((p) => p.status === "SUCCESS").reduce((a, p) => a + p.amountKobo, 0n)),
    },
    events: rows,
    lastEventId: orderEvents.at(-1)?.id.toString() ?? "0",
    simulatedIdentity: env().SIMULATE_IDENTITY || (await db().vendorVerification.count({ where: { id: order.verificationId, simulated: true } })) > 0,
    sandboxRoute: routeNote ? `${routeNote.destinationBankCode}/${routeNote.destinationAccount}` : null,
    testMode: e.KORA_SECRET_KEY.startsWith("sk_test_"),
    demoMode: e.DEMO_MODE,
  };
}
