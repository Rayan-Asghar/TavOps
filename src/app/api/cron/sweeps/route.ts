import { NextResponse } from "next/server";
import { runAllSweeps } from "@/server/sweeps";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { log, newRequestId } from "@/lib/logger";

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
    log.info("cron.sweeps.done", {
      requestId,
      ms: Date.now() - startedAt,
      ...result,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
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
