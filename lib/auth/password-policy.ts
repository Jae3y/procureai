import { createHash } from "node:crypto";
import { DomainError } from "@/lib/domain/errors";
import { env } from "@/lib/env";
import { log } from "@/lib/log";

/**
 * What a new password must be: long enough, not built from the person's own name or email, not one
 * of the passwords attackers try first, and not one already published in a data breach.
 *
 * The breach check uses Have I Been Pwned's range API (k-anonymity): only the first 5 characters of
 * the password's SHA-1 leave the server, never the password or its full hash. If the service can't be
 * reached, the other rules still apply and sign-up goes ahead.
 */

const COMMON = new Set([
  "password", "password1", "password12", "password123", "password1234", "passw0rd", "p@ssw0rd", "p@ssword1",
  "1234567890", "12345678910", "0123456789", "123456789a", "1q2w3e4r5t", "qwertyuiop", "qwerty1234", "qwerty12345",
  "iloveyou12", "letmein123", "welcome123", "welcome1234", "admin12345", "abc1234567", "abcdefghij", "zaq12wsxcde",
  "procureai", "procureai1", "procureai123", "nigeria123", "nigeria1234", "lagos12345", "jesus12345", "godisgood1",
  "football12", "princess12", "sunshine12", "1111111111", "0000000000", "aaaaaaaaaa",
]);

export async function isBreachedPassword(password: string): Promise<boolean> {
  const sha1 = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "ProcureAI password check" },
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) {
      log.warn({ status: res.status }, "breached-password check unavailable; continuing without it");
      return false;
    }
    const body = await res.text();
    return body.split("\n").some((line) => {
      const [hash, count] = line.trim().split(":");
      return hash === suffix && Number(count) > 0;
    });
  } catch (err) {
    log.warn({ err: String(err) }, "breached-password check unreachable; continuing without it");
    return false;
  }
}

export async function assertAcceptablePassword(password: string, person: { email: string; name?: string }, field = "password"): Promise<void> {
  const lower = password.toLowerCase();
  const local = person.email.split("@")[0]?.toLowerCase() ?? "";
  const words = (person.name ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  // Each long part of the name, and the whole name run together ("adaobi" for "Ada Obi").
  const nameParts = [...words.filter((p) => p.length >= 4), words.join("")].filter((p) => p.length >= 4);
  const weak = () => new DomainError("weak_password", "Choose a harder password: avoid your name, your email and common passwords.", 400, { issues: [{ path: field, message: "Avoid your name, your email and common passwords" }] });
  if (COMMON.has(lower) || new Set(lower).size <= 2) throw weak();
  if (local.length >= 4 && lower.includes(local)) throw weak();
  if (nameParts.some((p) => lower.includes(p))) throw weak();
  if (env().PASSWORD_BREACH_CHECK && (await isBreachedPassword(password))) {
    throw new DomainError("breached_password", "This password has appeared in a data breach elsewhere, so attackers already know it. Choose another.", 400, {
      issues: [{ path: field, message: "This password has appeared in a data breach. Choose another." }],
    });
  }
}
