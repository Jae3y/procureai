import "dotenv/config";
import ngrok from "@ngrok/ngrok";

const authtoken = process.env.NGROK_AUTHTOKEN;
const domain = process.env.NGROK_DOMAIN || "footless-carpenter-resilient.ngrok-free.dev";
const port = Number(process.env.PORT || 3000);

async function main() {
  if (!authtoken) {
    console.error("Missing NGROK_AUTHTOKEN in .env");
    console.error("Get your token from: https://dashboard.ngrok.com/get-started/your-authtoken");
    process.exitCode = 1;
    return;
  }

  console.log(`Starting ngrok tunnel for ${domain} -> http://localhost:${port}...`);
  const listener = await ngrok.forward({
    addr: port,
    authtoken,
    domain,
  });

  console.log(`\n======================================================`);
  console.log(`✅ Ngrok Tunnel Online: ${listener.url()}`);
  console.log(`📡 Forwarding to: http://localhost:${port}`);
  console.log(`🎯 Kora Webhook Target: ${listener.url()}/api/webhooks/kora`);
  console.log(`======================================================\n`);

  // Keep alive until process terminated
  process.stdin.resume();
}

main().catch((err: unknown) => {
  console.error("Tunnel error:", err);
  process.exitCode = 1;
});
