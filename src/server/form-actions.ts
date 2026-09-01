"use server";

import { logWork, editWorkLog, deleteWorkLog } from "./work-logs";
import { reportBlocker } from "./blockers";
import { resolveBlocker } from "./blockers";
import { safeErrorMessage } from "./action-errors";

export type FormState = { ok?: boolean; error?: string; message?: string };

function toState(err: unknown, action: string): FormState {
  return { error: safeErrorMessage(err, action) };
}

export async function logWorkFormAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const taskId = String(formData.get("taskId") ?? "");
    const status = String(formData.get("resultingStatus") ?? "");

    await logWork({
      projectId: String(formData.get("projectId") ?? ""),
      taskId: taskId === "" ? null : taskId,
      hours: Number(formData.get("hours") ?? 0),
      internalNotes: String(formData.get("internalNotes") ?? ""),
      resultingStatus: status === "" ? null : (status as never),
    });

    return { ok: true, message: "Logged." };
  } catch (err) {
    return toState(err, "logWork");
  }
}

export async function reportBlockerFormAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const taskId = String(formData.get("taskId") ?? "");
    const blockedOn = String(formData.get("blockedOnUserId") ?? "");
    await reportBlocker({
      projectId: String(formData.get("projectId") ?? ""),
      taskId: taskId === "" ? null : taskId,
      category: String(formData.get("category") ?? "other") as never,
      severity: String(formData.get("severity") || "normal") as never,
      blockedOnUserId: blockedOn === "" ? undefined : blockedOn,
      description: String(formData.get("description") ?? ""),
    });
    return { ok: true, message: "Reported and routed to the right person." };
  } catch (err) {
    return toState(err, "reportBlocker");
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
    return toState(err, "resolveBlocker");
  }
}

export async function editWorkLogFormAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const workDate = String(formData.get("workDate") ?? "");
    await editWorkLog({
      workLogId: String(formData.get("workLogId") ?? ""),
      hours: Number(formData.get("hours") ?? 0),
      internalNotes: String(formData.get("internalNotes") ?? ""),
      workDate: workDate === "" ? undefined : workDate,
      reason: String(formData.get("reason") ?? ""),
    });
    return { ok: true, message: "Entry corrected." };
  } catch (err) {
    return toState(err, "editWorkLog");
  }
}

export async function deleteWorkLogFormAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await deleteWorkLog({
      workLogId: String(formData.get("workLogId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    return { ok: true, message: "Entry removed." };
  } catch (err) {
    return toState(err, "deleteWorkLog");
  }
}
