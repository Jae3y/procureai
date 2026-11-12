import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/market/listings/:id/photo — a live listing's photo. Public, and cached briefly. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!/^[a-z0-9]{10,40}$/i.test(id)) return new Response("Not found", { status: 404 });
  const l = await db().listing.findUnique({ where: { id }, select: { photo: true, photoType: true, status: true, contact: { select: { registeredAt: true, isDemo: true } } } });
  if (!l?.photo || !l.photoType || l.status !== "ACTIVE" || !l.contact.registeredAt || l.contact.isDemo) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(l.photo), {
    headers: { "Content-Type": l.photoType, "Cache-Control": "public, max-age=300, stale-while-revalidate=3600", "X-Content-Type-Options": "nosniff" },
  });
}
