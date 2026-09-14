// A stand-in for a platform cron, for a VM or a laptop: rings the scheduler's
// bell once a minute. On Vercel, Render, Railway or a Kubernetes CronJob, use
// the platform's own cron to call /api/cron/tick instead of running this.
//
//   npm run scheduler
//
// Reads CRON_SECRET from .env, and SCHEDULER_URL (default
// http://localhost:3010/api/cron/tick). Never prints the secret.
import "dotenv/config";

const url = process.env.SCHEDULER_URL ?? "http://localhost:3010/api/cron/tick";
const secret = process.env.CRON_SECRET;
const everyMs = Number(process.env.SCHEDULER_INTERVAL_MS ?? 60_000);

if (!secret || secret.length < 32) {
  console.error("CRON_SECRET is missing or shorter than 32 characters; the tick endpoint would refuse every call.");
  process.exit(1);
}

async function ring() {
  const started = new Date();
  try {
    const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
    const body = await res.json().catch(() => ({}));
    const ran = (body.jobs ?? []).filter((j) => j.status !== "not_due");
    const line = ran.length === 0 ? "nothing due" : ran.map((j) => `${j.key}=${j.status}`).join(" ");
    console.log(`[scheduler] ${started.toISOString()} ${res.status} ${line}`);
  } catch (e) {
    console.error(`[scheduler] ${started.toISOString()} could not reach ${url}: ${e instanceof Error ? e.message : e}`);
  }
}

await ring();
setInterval(ring, everyMs);
