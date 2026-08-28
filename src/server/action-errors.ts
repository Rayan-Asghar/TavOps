import { z } from "zod";
import { NotAuthorizedError } from "@/lib/access";
import { UnauthenticatedError } from "@/lib/auth";
import { UserFacingError } from "@/lib/errors";
import { ForbiddenError } from "@/lib/rbac";
import { log, newRequestId } from "@/lib/logger";

/**
 * The single place that decides what a failed server action tells the browser.
 *
 * Not a `"use server"` module on purpose — see HANDOFF §4.13. Every export of a
 * `"use server"` file becomes a callable endpoint, so shared helpers live out
 * here instead.
 *
 * Safe by default: only errors that are explicitly meant for a person get their
 * message through. Everything else is logged against a short reference and
 * reduced to a generic line, because the alternative — which is what the code
 * used to do — puts raw Postgres text on a developer's screen.
 */
export function safeErrorMessage(err: unknown, action: string): string {
  if (err instanceof z.ZodError) {
    return err.issues[0]?.message ?? "Check the form and try again.";
  }

  // Written for the person reading it.
  if (err instanceof UserFacingError) return err.message;

  // Authorization outcomes are intended and safe to describe. The capability
  // name is withheld: it names internals and means nothing to the reader.
  if (err instanceof ForbiddenError) {
    return "You do not have permission to do that.";
  }
  if (err instanceof NotAuthorizedError) return err.message;
  if (err instanceof UnauthenticatedError) {
    return "Your session has expired. Sign in again.";
  }

  const requestId = newRequestId();
  log.error("action.failed", { action, requestId, err });
  return `Something went wrong and has been logged. Reference ${requestId}.`;
}
