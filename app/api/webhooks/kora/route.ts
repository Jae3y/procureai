import { runAfterResponse } from "@/lib/http/after";
import { log, withLogContext } from "@/lib/log";
import { receiveKoraWebhook } from "@/lib/webhooks/receive";
import { processOutboxSoon } from "@/lib/worker/outbox";

/**
 * POST /api/webhooks/kora
 *
 * - Reads the RAW body with request.text(). App Router route handlers never pre-parse the body, so
 *   the bytes we HMAC are the bytes Kora sent (the classic signature bug is verifying a re-parsed body).
 * - Always answers 200, quickly. Kora retries non-200s for 72h, and a handler that 5xxs on every
 *   delivery is a known real-world failure. If even storing the event fails, the raw body is logged
 *   for replay and the reconciliation poller still resolves the order by querying Kora.
 * - Processing happens after the response (outbox), under the order lock.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withLogContext({}, async () => {
    let rawBody = "";
    try {
      rawBody = await request.text();
      const result = await receiveKoraWebhook({ rawBody, signatureHeader: request.headers.get("x-korapay-signature") });
      if (result.enqueued) runAfterResponse("kora-webhook-outbox", processOutboxSoon);
      log.info({ webhook: result }, "kora webhook received");
      return Response.json({ received: true }, { status: 200 });
    } catch (err) {
      log.error({ err, rawBody: rawBody.slice(0, 4000) }, "kora webhook could not be stored; answered 200, poller will reconcile");
      return Response.json({ received: true }, { status: 200 });
    }
  });
}
