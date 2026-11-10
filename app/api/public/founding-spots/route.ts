import { FOUNDING_VENDOR_LIMIT, foundingSpotsTaken } from "@/lib/founding";
import { log } from "@/lib/log";

export const runtime = "nodejs";

/** GET /api/public/founding-spots — how many Founding Vendor spots are taken. Cached for a minute at the edge. */
export async function GET(): Promise<Response> {
  try {
    const taken = await foundingSpotsTaken();
    return Response.json({ taken, limit: FOUNDING_VENDOR_LIMIT }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
  } catch (err) {
    log.warn({ err: String(err) }, "founding-spots count unavailable");
    return Response.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
