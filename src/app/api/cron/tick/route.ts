import { checkCronAuth } from "@/modules/scheduler/cron-auth";
import { runDueJobs } from "@/modules/scheduler/runner.service";

/**
 * The scheduler's bell. Something outside the app calls this every minute —
 * a platform cron, a systemd timer, or `npm run scheduler` — and each call
 * runs whichever jobs are due. See src/modules/scheduler/schedule.ts for why
 * it is a tick and not a timer inside the web process.
 *
 * GET and POST both work: Vercel Cron sends GET, most other schedulers POST.
 * The response carries job statuses and counts, never records — and only to
 * a caller holding CRON_SECRET.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

async function tick(request: Request): Promise<Response> {
  const auth = checkCronAuth(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (auth === "not_configured") {
    return Response.json({ status: "not_configured", detail: "Set CRON_SECRET (32+ characters) to enable the scheduler." }, { status: 503, headers: NO_STORE });
  }
  if (auth === "unauthorized") return Response.json({ status: "unauthorized" }, { status: 401, headers: NO_STORE });

  const jobs = await runDueJobs(new Date());
  return Response.json({ status: "ok", jobs }, { headers: NO_STORE });
}

export async function GET(request: Request) {
  return tick(request);
}

export async function POST(request: Request) {
  return tick(request);
}
