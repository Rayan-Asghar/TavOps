import { timingSafeEqual } from "node:crypto";

/**
 * Cron endpoints sit outside the session gate, so they carry their own shared
 * secret. Compared in constant time so the check cannot be probed byte by byte.
 */
export function isAuthorizedCron(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const header = req.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : header;

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
