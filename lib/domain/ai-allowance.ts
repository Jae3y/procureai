import { lagosDate } from "@/lib/ai/dates";
import { db } from "@/lib/db";
import type { Account } from "@/lib/generated/prisma/client";
import { DomainError } from "./errors";

/**
 * How many AI-written purchase requests an account can start per Lagos day. Browsing the marketplace and
 * requesting from a listing never count. The AI costs money per call, so free accounts get a small daily
 * allowance and ProcureAI Plus members a larger one.
 */
export const AI_REQUESTS_PER_DAY = { free: 2, plus: 5 } as const;

export function isPlus(account: Pick<Account, "plusUntil">, now = new Date()): boolean {
  return Boolean(account.plusUntil && account.plusUntil > now);
}

export function dailyAiLimit(account: Pick<Account, "plusUntil">, now = new Date()): number {
  return isPlus(account, now) ? AI_REQUESTS_PER_DAY.plus : AI_REQUESTS_PER_DAY.free;
}

/** Remaining AI requests today, for showing on the page. */
export async function aiRequestsLeft(account: Pick<Account, "id" | "plusUntil">, now = new Date()): Promise<{ left: number; limit: number }> {
  const limit = dailyAiLimit(account, now);
  const row = await db().aiDailyUse.findUnique({ where: { accountId_day: { accountId: account.id, day: lagosDate(now) } } });
  return { left: Math.max(0, limit - (row?.count ?? 0)), limit };
}

/**
 * Takes one from today's allowance, or refuses. Atomic: the row is created or bumped only while still under
 * the limit, so two tabs racing can't both slip past it.
 */
export async function useAiRequest(account: Pick<Account, "id" | "plusUntil">, now = new Date()): Promise<void> {
  const limit = dailyAiLimit(account, now);
  const day = lagosDate(now);
  const bumped = await db().$executeRaw`
    INSERT INTO "AiDailyUse" ("accountId", "day", "count") VALUES (${account.id}, ${day}, 1)
    ON CONFLICT ("accountId", "day") DO UPDATE SET "count" = "AiDailyUse"."count" + 1
    WHERE "AiDailyUse"."count" < ${limit}`;
  if (bumped === 0) {
    throw new DomainError(
      "ai_daily_limit",
      isPlus(account, now)
        ? `You've used today's ${limit} AI requests. They come back tomorrow. You can still browse the marketplace and request from any listing.`
        : `You've used today's ${limit} free AI requests. They come back tomorrow, or ProcureAI Plus gives you ${AI_REQUESTS_PER_DAY.plus} a day. You can still browse the marketplace and request from any listing.`,
      429,
    );
  }
}

/** Gives one back when the AI never ran or the request couldn't be understood, so a failed try doesn't cost the buyer. */
export async function refundAiRequest(account: Pick<Account, "id">, now = new Date()): Promise<void> {
  await db().aiDailyUse.updateMany({ where: { accountId: account.id, day: lagosDate(now), count: { gt: 0 } }, data: { count: { decrement: 1 } } });
}
