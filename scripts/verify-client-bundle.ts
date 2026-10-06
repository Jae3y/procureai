/**
 * npm run verify:bundle — run after `next build`. Asserts no secret-shaped string reached any
 * client-side bundle: Kora secret keys (sk_test_/sk_live_), the configured secrets themselves, or
 * the record-signing secret.
 */
import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const STATIC = path.join(process.cwd(), ".next", "static");

async function* files(dir: string): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (/\.(js|css|json|html)$/.test(e.name)) yield p;
  }
}

async function main() {
  const secrets = [process.env.KORA_SECRET_KEY, process.env.RECORD_SIGNING_SECRET, process.env.AI_API_KEY, process.env.ADMIN_TOKEN].filter(
    (s): s is string => typeof s === "string" && s.length >= 12,
  );
  const shaped = /sk_(test|live)_[A-Za-z0-9]{8,}/;
  let scanned = 0;
  const hits: string[] = [];
  try {
    for await (const f of files(STATIC)) {
      scanned++;
      const text = await readFile(f, "utf8");
      if (shaped.test(text)) hits.push(`${f}: Kora secret-key-shaped string`);
      for (const s of secrets) if (text.includes(s)) hits.push(`${f}: contains a configured secret`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.error("No .next/static — run `npm run build` first.");
      process.exitCode = 1;
      return;
    }
    throw err;
  }
  if (hits.length) {
    console.error(hits.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(`verify:bundle — ${scanned} client files scanned, no secrets or sk_ keys found.`);
  }
}

void main();
