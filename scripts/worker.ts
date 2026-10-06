/**
 * npm run worker — runs the outbox + reconciliation poller as its own process (useful when the web
 * server is a platform without a background loop, or to watch ticks in a terminal).
 */
import "dotenv/config";
import { log } from "@/lib/log";
import { startBackgroundLoop } from "@/lib/worker/tick";

startBackgroundLoop(Number(process.env.TICK_MS ?? 5000));
log.info("worker running; Ctrl+C to stop");
setInterval(() => undefined, 1 << 30);
