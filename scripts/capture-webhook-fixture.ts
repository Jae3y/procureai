/**
 * npm run capture:webhook-fixture — copies the most recent REAL, signature-valid Kora webhook from
 * the database into tests/fixtures/kora/captured-webhook.json, so the signature test runs against a
 * payload Kora actually sent (BLOCKERS.md B-06). The fixture stores the raw body and header only.
 */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db, disconnectDb } from "@/lib/db";

async function main() {
  const e = await db().koraEvent.findFirst({
    where: { source: "WEBHOOK", signatureValid: true, demoNote: null },
    orderBy: { receivedAt: "desc" },
  });
  if (!e?.rawBody || !e.signatureHeader) {
    console.error("No signature-valid webhook from Kora has been received yet. Complete one sandbox payment first.");
    process.exitCode = 1;
    return;
  }
  const dir = path.join(process.cwd(), "tests", "fixtures", "kora");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "captured-webhook.json"),
    JSON.stringify({ capturedAt: e.receivedAt.toISOString(), type: e.type, rawBody: e.rawBody, signature: e.signatureHeader }, null, 2),
  );
  console.log(`Captured ${e.type} ${e.reference} → tests/fixtures/kora/captured-webhook.json`);
  console.log("The fixture was signed with your KORA_SECRET_KEY; the test reads the key from .env.");
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
