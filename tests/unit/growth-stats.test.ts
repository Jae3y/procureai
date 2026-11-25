import { describe, expect, it } from "vitest";
import { attributionFromLanding, cleanTag, decodeAttribution, encodeAttribution, referrerHostOf } from "@/lib/attribution";
import { parseEnv } from "@/lib/env";
import { lagosDayRange, parseDay, sourceKey, yesterdayInLagos } from "@/lib/growth-stats";

describe("growth stats: Lagos calendar days", () => {
  it("accepts only real YYYY-MM-DD dates", () => {
    expect(parseDay("2026-11-20")).toBe("2026-11-20");
    expect(parseDay("2028-02-29")).toBe("2028-02-29");
    for (const bad of ["2026-02-30", "2026-13-01", "20261120", "2026-11-20T00:00:00Z", "yesterday", "", " 2026-11-20"]) expect(parseDay(bad)).toBeNull();
  });

  it("a Lagos day runs from 23:00 UTC the evening before to 23:00 UTC", () => {
    const { start, end } = lagosDayRange("2026-11-20");
    expect(start.toISOString()).toBe("2026-11-19T23:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-20T23:00:00.000Z");
  });

  it("'yesterday' is yesterday in Lagos, not in UTC", () => {
    expect(yesterdayInLagos(new Date("2026-11-25T12:00:00Z"))).toBe("2026-11-24");
    // 23:30 UTC on the 25th is already 00:30 on the 26th in Lagos.
    expect(yesterdayInLagos(new Date("2026-11-25T23:30:00Z"))).toBe("2026-11-25");
    expect(yesterdayInLagos(new Date("2026-11-25T22:59:59Z"))).toBe("2026-11-24");
  });
});

describe("growth stats: source keys", () => {
  const k = (utmSource: string | null, heardFrom: string | null = null, referrerHost: string | null = null) => sourceKey({ utmSource, heardFrom, referrerHost });
  it("shows short tags and buckets anything that could identify a person as other", () => {
    expect(k("instagram")).toBe("instagram");
    expect(k(null, "WHATSAPP")).toBe("whatsapp");
    expect(k(null, null, "google.com")).toBe("google.com");
    expect(k(null)).toBe("unknown");
    for (const risky of ["08031234567", "ada.obi.234803123", "__proto__", "x".repeat(40), "1abc"]) expect(k(risky)).toBe("other");
  });
});

describe("first-touch attribution", () => {
  it("takes the utm tags from the landing URL, cleaned and lower-cased", () => {
    const a = attributionFromLanding(new URL("https://procureai.com.ng/?utm_source=Instagram&utm_medium=Social Bio&utm_campaign=launch<script>"), null, "procureai.com.ng");
    expect(a).toEqual({ utmSource: "instagram", utmMedium: "social_bio", utmCampaign: "launchscript", referrerHost: null });
  });

  it("falls back to the referring site's host when there are no utm tags, and ignores our own pages", () => {
    expect(attributionFromLanding(new URL("https://procureai.com.ng/"), "https://www.google.com/search?q=x", "procureai.com.ng")).toEqual({
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      referrerHost: "google.com",
    });
    expect(attributionFromLanding(new URL("https://procureai.com.ng/help"), "https://procureai.com.ng/", "procureai.com.ng")).toBeNull();
    expect(attributionFromLanding(new URL("https://procureai.com.ng/"), null, "procureai.com.ng")).toBeNull();
    expect(referrerHostOf("not a url", "procureai.com.ng")).toBeNull();
  });

  it("round-trips through the cookie and re-cleans whatever the visitor put there", () => {
    const a = { utmSource: "x", utmMedium: "social", utmCampaign: "launch", referrerHost: null };
    expect(decodeAttribution(encodeAttribution(a))).toEqual(a);
    expect(decodeAttribution("s=" + "A".repeat(200) + "%20%3Cb%3E")).toMatchObject({ utmSource: "a".repeat(64) });
    expect(decodeAttribution(undefined)).toEqual({ utmSource: null, utmMedium: null, utmCampaign: null, referrerHost: null });
    expect(cleanTag("   ")).toBeNull();
  });
});

describe("GROWTH_STATS_TOKEN", () => {
  const base = {
    KORA_SECRET_KEY: "sk_test_x",
    KORA_PUBLIC_KEY: "pk_test_x",
    KORA_WEBHOOK_URL: "https://procureai.test/api/webhooks/kora",
    DATABASE_URL: "postgresql://x",
    APP_BASE_URL: "http://localhost:3000",
    RECORD_SIGNING_SECRET: "0123456789abcdef0123456789abcdef",
    DEMO_MODE: "true",
  };

  it("is optional, and refused when too short to be a secret", () => {
    expect(parseEnv(base).GROWTH_STATS_TOKEN).toBeUndefined();
    expect(parseEnv({ ...base, GROWTH_STATS_TOKEN: "x".repeat(32) }).GROWTH_STATS_TOKEN).toBe("x".repeat(32));
    expect(() => parseEnv({ ...base, GROWTH_STATS_TOKEN: "short" })).toThrow(/GROWTH_STATS_TOKEN/);
  });
});
