"use server";

import { z } from "zod";
import { logWork } from "./work-logs";
import { reportBlocker } from "./blockers";
import { resolveBlocker } from "./blockers";

export type FormState = { ok?: boolean; error?: string; message?: string };

/** Turns thrown validation/authorization errors into something renderable. */
function toState(err: unknown): FormState {
  if (err instanceof z.ZodError) {
    return { error: err.issues[0]?.message ?? "Check the form and try again." };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { error: message };
}

export async function logWorkFormAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const taskId = String(formData.get("taskId") ?? "");
    const status = String(formData.get("resultingStatus") ?? "");

    const result = await logWork({
      projectId: String(formData.get("projectId") ?? ""),
      taskId: taskId === "" ? null : taskId,
      hours: Number(formData.get("hours") ?? 0),
      notes: String(formData.get("notes") ?? ""),
      resultingStatus: status === "" ? null : (status as never),
    });

    return {
      ok: true,
      message: result.queuedSync
        ? "Logged. Client sheet update queued."
        : "Logged.",
    };
  } catch (err) {
    return toState(err);
  }
}

export async function reportBlockerFormAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const taskId = String(formData.get("taskId") ?? "");
    await reportBlocker({
      projectId: String(formData.get("projectId") ?? ""),
      taskId: taskId === "" ? null : taskId,
      category: String(formData.get("category") ?? "other") as never,
      description: String(formData.get("description") ?? ""),
      isUrgent: formData.get("isUrgent") === "on",
    });
    return { ok: true, message: "Reported. The right person has been notified." };
  } catch (err) {
    return toState(err);
  }
}

export async function resolveBlockerFormAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await resolveBlocker({
      blockerId: String(formData.get("blockerId") ?? ""),
      resolutionNote: String(formData.get("resolutionNote") ?? ""),
    });
    return { ok: true, message: "Resolved." };
  } catch (err) {
    return toState(err);
  }
}
