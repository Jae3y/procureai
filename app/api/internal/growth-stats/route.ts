import { safeEqual } from "@/lib/crypto";
import { DomainError } from "@/lib/domain/errors";
import { env } from "@/lib/env";
import { growthStats, parseDay, yesterdayInLagos } from "@/lib/growth-stats";
import { route } from "@/lib/http/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/internal/growth-stats?date=YYYY-MM-DD — one Africa/Lagos day of sign-ups, activations and purchases, as
 * aggregate counts only, for the owner's local Growth Engine (it pulls once a day). `date` defaults to yesterday.
 * Off (404) until GROWTH_STATS_TOKEN is set; then it needs `Authorization: Bearer <GROWTH_STATS_TOKEN>`. Never cached.
 */
export const GET = route(
  { name: "internal.growth-stats", limits: ({ ip }) => [{ key: `growth-stats:${ip}`, limit: 60, windowSeconds: 3600 }] },
  async ({ req }) => {
    const token = env().GROWTH_STATS_TOKEN;
    if (!token) throw new DomainError("not_found", "Not found.", 404);
    const header = req.headers.get("authorization") ?? "";
    const given = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    if (!given || !safeEqual(given, token)) throw new DomainError("unauthorized", "A valid bearer token is required.", 401);

    const raw = new URL(req.url).searchParams.get("date");
    const day = raw === null ? yesterdayInLagos(new Date()) : parseDay(raw);
    if (!day) throw new DomainError("invalid_date", "date must be a calendar date in YYYY-MM-DD form.", 400);

    return { body: await growthStats(day) };
  },
);
