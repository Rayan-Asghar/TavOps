import { NextResponse } from "next/server";
import { runSyncWorker } from "@/server/sync-worker";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { log, newRequestId } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const requestId = newRequestId();

  if (!isAuthorizedCron(req)) {
    // Logged at warn: a scheduler with a stale secret fails silently forever
    // otherwise, and looks identical to a scheduler that was never configured.
    log.warn("cron.sync.unauthorized", { requestId });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const result = await runSyncWorker();
    log.info("cron.sync.done", {
      requestId,
      ms: Date.now() - startedAt,
      ...result,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    log.error("cron.sync.failed", {
      requestId,
      ms: Date.now() - startedAt,
      err,
    });
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: message, requestId },
      { status: 500 },
    );
  }
}

export const GET = POST;
