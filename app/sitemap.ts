import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { log } from "@/lib/log";

const BASE = "https://procureai.com.ng";

/** Read on request (not at build time), so new products and sellers appear without a redeploy. */
export const dynamic = "force-dynamic";

const STATIC: MetadataRoute.Sitemap = [
  { url: `${BASE}/`, changeFrequency: "weekly", priority: 1 },
  { url: `${BASE}/market`, changeFrequency: "daily", priority: 0.9 },
  { url: `${BASE}/vendors/join`, changeFrequency: "monthly", priority: 0.8 },
  { url: `${BASE}/signup`, changeFrequency: "monthly", priority: 0.6 },
  { url: `${BASE}/terms`, changeFrequency: "monthly", priority: 0.3 },
  { url: `${BASE}/privacy`, changeFrequency: "monthly", priority: 0.3 },
  { url: `${BASE}/refunds`, changeFrequency: "monthly", priority: 0.3 },
];

/**
 * The public pages, plus every live product and every registered seller's page (the pages most likely to bring
 * buyers in from search). Demo sellers and hidden products stay out. If the database can't be read, the static
 * pages are still listed.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  try {
    const [listings, sellers] = await Promise.all([
      db().listing.findMany({
        where: { status: "ACTIVE", contact: { registeredAt: { not: null }, isDemo: false } },
        select: { id: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 5000,
      }),
      db().vendorContact.findMany({ where: { registeredAt: { not: null }, isDemo: false }, select: { id: true, registeredAt: true }, take: 5000 }),
    ]);
    return [
      ...STATIC,
      ...listings.map((l) => ({ url: `${BASE}/market/${l.id}`, lastModified: l.updatedAt, changeFrequency: "weekly" as const, priority: 0.7 })),
      ...sellers.map((s) => ({ url: `${BASE}/sellers/${s.id}`, ...(s.registeredAt ? { lastModified: s.registeredAt } : {}), changeFrequency: "weekly" as const, priority: 0.5 })),
    ];
  } catch (err) {
    log.warn({ err: String(err) }, "sitemap: database unavailable; listing the static pages only");
    return STATIC;
  }
}
