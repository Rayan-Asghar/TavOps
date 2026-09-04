import { NextResponse } from "next/server";
import { runAllSweeps } from "@/server/sweeps";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { log, newRequestId } from "@/lib/logger";
import { recordCronRun } from "@/server/scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const requestId = newRequestId();

  if (!isAuthorizedCron(req)) {
    log.warn("cron.sweeps.unauthorized", { requestId });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const result = await runAllSweeps();
    await recordCronRun("sweeps", "ok", Date.now() - startedAt);
    log.info("cron.sweeps.done", {
      requestId,
      ms: Date.now() - startedAt,
      ...result,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    // Recorded even on failure: an attempt at 10:00 that died is still an
    // attempt, and the heartbeat must not immediately retry a job that
    // reliably crashes.
    await recordCronRun("sweeps", "error", Date.now() - startedAt, err);
    log.error("cron.sweeps.failed", {
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
