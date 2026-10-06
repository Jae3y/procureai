import { verifyRecordId } from "@/lib/crypto";
import { NotFoundError } from "@/lib/domain/errors";
import { route } from "@/lib/http/route";
import { buildRecordView } from "@/lib/views/record-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/record/:signedId — the shareable record. The id carries a MAC; guessing an order id is not enough. */
export const GET = route<undefined, { signedId: string }>(
  { name: "record.get", limits: ({ ip }) => [{ key: `record:${ip}`, limit: 120, windowSeconds: 60 }] },
  async ({ params }) => {
    const orderId = verifyRecordId(params.signedId);
    if (!orderId) throw new NotFoundError("Record");
    return { body: await buildRecordView(orderId) };
  },
);
