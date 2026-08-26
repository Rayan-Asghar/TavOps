"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireActor } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/access";
import { assertCan } from "@/lib/rbac";
import { logWorkSchema, type LogWorkInput } from "./schemas";
import { recordWorkInTx } from "./record-work";

/**
 * The wedge: one submission from a developer fans out to everything else.
 * The fan-out itself lives in recordWorkInTx so the timer's finish step takes
 * exactly the same path.
 */
export async function logWork(input: LogWorkInput) {
  const actor = await requireActor();
  assertCan(actor.globalRole, "worklog.create");

  const data = logWorkSchema.parse(input);
  await assertProjectAccess(actor, data.projectId);

  const result = await db.transaction((tx) =>
    recordWorkInTx(tx, {
      projectId: data.projectId,
      taskId: data.taskId ?? null,
      userId: actor.id,
      hours: data.hours,
      notes: data.notes,
      resultingStatus: data.resultingStatus ?? null,
    }),
  );

  revalidatePath(`/projects/${data.projectId}`);
  revalidatePath("/");
  return result;
}
