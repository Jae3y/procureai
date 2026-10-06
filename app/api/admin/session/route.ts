import { z } from "zod";
import { safeEqual } from "@/lib/crypto";
import { DomainError } from "@/lib/domain/errors";
import { env } from "@/lib/env";
import { route } from "@/lib/http/route";
import { adminSessionCookie } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ token: z.string().min(1).max(200) });

/** POST /api/admin/session — exchange ADMIN_TOKEN for a signed admin cookie. */
export const POST = route<z.output<typeof Body>>(
  { name: "admin.session", input: Body, limits: ({ ip }) => [{ key: `admin-login:${ip}`, limit: 10, windowSeconds: 600 }] },
  async ({ input }) => {
    const expected = env().ADMIN_TOKEN;
    if (!expected || !safeEqual(input.token, expected)) throw new DomainError("forbidden", "That admin token isn't right.", 403);
    return { body: { ok: true }, cookies: [adminSessionCookie()] };
  },
);
