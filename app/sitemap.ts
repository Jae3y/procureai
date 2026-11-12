import type { MetadataRoute } from "next";

const BASE = "https://procureai.com.ng";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${BASE}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/market`, changeFrequency: "daily", priority: 0.9 },
    { url: `${BASE}/vendors/join`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/signup`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/terms`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${BASE}/privacy`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${BASE}/refunds`, changeFrequency: "monthly", priority: 0.3 },
  ];
}
