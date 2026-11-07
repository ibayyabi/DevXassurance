/**
 * Internal entry point for the automatic assessment queue.
 *
 * A scheduler (n8n, cron, or a database webhook) calls this route; no user
 * session and no dashboard visit is involved. The route only drains assessment
 * work: it claims fenced jobs, runs the deterministic pipeline over published
 * observations, and publishes snapshots. It never calls a provider and never
 * enqueues or retries extraction.
 *
 * Service-role credentials stay here, never in a browser: the caller presents
 * XASS_ASSESSMENT_SECRET and the route builds its own service-role client.
 */
import { NextResponse, type NextRequest } from "next/server";

import { runAutomaticAssessments } from "@/features/assurance/lib/automatic-assessment";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BATCH_LIMIT = 25;

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.XASS_ASSESSMENT_SECRET;
  if (!expectedSecret) {
    return NextResponse.json(
      { ok: false, error: "Automatic assessment authentication is not configured." },
      { status: 503 },
    );
  }
  if (request.headers.get("x-xass-assessment-secret") !== expectedSecret) {
    return NextResponse.json({ ok: false, error: "Invalid assessment secret." }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as { limit?: unknown };
  const requested = typeof payload.limit === "number" && Number.isFinite(payload.limit)
    ? Math.trunc(payload.limit)
    : undefined;
  const limit = requested === undefined
    ? undefined
    : Math.min(Math.max(requested, 1), MAX_BATCH_LIMIT);

  try {
    const supabase = createServiceRoleClient();
    const batch = await runAutomaticAssessments(supabase, {
      worker: "internal_api",
      limit,
    });
    return NextResponse.json({ ok: true, ...batch });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Automatic assessment failed.",
      },
      { status: 500 },
    );
  }
}
