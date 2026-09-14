import { db } from "@/lib/db";

/**
 * Liveness and readiness in one endpoint (blueprint Phase 12:
 * "observability").
 *
 * It answers the only question a load balancer actually needs — can this
 * instance serve a request that touches the database — and deliberately
 * answers nothing else. No version, no migration state, no table counts,
 * no environment: a health endpoint is unauthenticated by necessity, so
 * everything it reveals is revealed to the internet.
 *
 * Returns 503 when the database is unreachable so an orchestrator takes the
 * instance out of rotation rather than sending it traffic it cannot serve.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json(
      { status: "ok", checks: { database: "ok" }, latencyMs: Date.now() - started },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    // The error itself is logged server-side by the caller's stack, not
    // returned: a connection string in a health response is a gift.
    return Response.json(
      { status: "degraded", checks: { database: "unreachable" }, latencyMs: Date.now() - started },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
