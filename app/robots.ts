import type { MetadataRoute } from "next";

/** Search engines may index the public pages; accounts, orders, records and the API stay out. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/account", "/vendor", "/admin", "/orders/", "/buy/", "/v/", "/r/", "/reset", "/verify"] },
    sitemap: "https://procureai.com.ng/sitemap.xml",
  };
}
