import { NextResponse } from "next/server";
import { buildDigest, renderDigest } from "@/server/digest";
import { deliver } from "@/server/webhooks";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { log, newRequestId } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled once a day, near the start of the shift (13:00 UTC / 18:00 PKT).
 *
 * `?dry=1` renders without sending, which is how you check the wording without
 * putting a test message in front of the whole team.
 */
export async function POST(req: Request) {
  const requestId = newRequestId();

  if (!isAuthorizedCron(req)) {
    log.warn("cron.digest.unauthorized", { requestId });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const dry = new URL(req.url).searchParams.get("dry") === "1";
  const startedAt = Date.now();

  try {
    const digest = await buildDigest();
    const message = renderDigest(digest);

    const delivery = dry
      ? { delivered: 0, failed: 0, configured: 0 }
      : await deliver(message);

    log.info("cron.digest.done", {
      requestId,
      ms: Date.now() - startedAt,
      dry,
      projects: digest.projects.length,
      stuckBlockers: digest.stuckBlockers.length,
      ...delivery,
    });

    return NextResponse.json({ ok: true, dry, ...delivery, message });
  } catch (err) {
    log.error("cron.digest.failed", {
      requestId,
      ms: Date.now() - startedAt,
      err,
    });
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: msg, requestId },
      { status: 500 },
    );
  }
}

export const GET = POST;
