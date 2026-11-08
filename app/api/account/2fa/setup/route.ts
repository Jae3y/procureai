import QRCode from "qrcode";
import { startTotpSetup } from "@/lib/domain/accounts";
import { Empty, route } from "@/lib/http/route";
import { requireAccount } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/account/2fa/setup — a new authenticator secret, as a QR code and as text to type in. */
export const POST = route({ name: "account.2fa.setup", input: Empty }, async ({ req }) => {
  const { secret, otpauth } = await startTotpSetup(await requireAccount(req));
  const qrSvg = await QRCode.toString(otpauth, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return { body: { secret, qrSvg } };
});
