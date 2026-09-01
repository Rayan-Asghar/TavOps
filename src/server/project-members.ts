"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { projectMembers, projects, tasks } from "@/db/schema";
import { requireActor } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/access";
import { assertCan } from "@/lib/rbac";
import { notify } from "./notifications";
import { safeErrorMessage } from "./action-errors";

import type { ActionState } from "@/lib/action-state";
import { UserFacingError } from "@/lib/errors";
export type MemberState = { ok?: boolean; error?: string; message?: string };

const addMemberSchema = z.object({
  projectId: z.string().uuid(),
  userId: z.string().uuid("Pick a person."),
  role: z.enum(["sales_owner", "pm", "tech_lead", "developer", "qa", "observer"]),
  expiresAt: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? new Date(v) : null)),
});

function fail(err: unknown): MemberState {
  if (err instanceof z.ZodError) {
    return { error: err.issues[0]?.message ?? "Check the form." };
  }
  return { error: safeErrorMessage(err, "projectMember") };
}

export async function addProjectMember(
  _prev: MemberState,
  formData: FormData,
): Promise<MemberState> {
  try {
    const actor = await requireActor();
    assertCan(actor.globalRole, "project.manageMembers");

    const data = addMemberSchema.parse({
      projectId: String(formData.get("projectId") ?? ""),
      userId: String(formData.get("userId") ?? ""),
      role: String(formData.get("role") ?? "developer"),
      expiresAt: formData.get("expiresAt") ?? "",
    });

    await assertProjectAccess(actor, data.projectId);

    if (data.expiresAt && data.expiresAt <= new Date()) {
      return { error: "The expiry date must be in the future." };
    }

    const [existing] = await db
      .select({ id: projectMembers.id })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, data.projectId),
          eq(projectMembers.userId, data.userId),
        ),
      )
      .limit(1);

    if (existing) {
      // Already on the project — treat this as a role change rather than an
      // error, which is what the person clicking almost always means.
      await db
        .update(projectMembers)
        .set({ role: data.role, expiresAt: data.expiresAt })
        .where(eq(projectMembers.id, existing.id));
      revalidatePath(`/projects/${data.projectId}`);
      return { ok: true, message: "Role updated." };
    }

    await db.transaction(async (tx) => {
      await tx.insert(projectMembers).values({
        projectId: data.projectId,
        userId: data.userId,
        role: data.role,
        expiresAt: data.expiresAt,
      });

      const [project] = await tx
        .select({ name: projects.name })
        .from(projects)
        .where(eq(projects.id, data.projectId))
        .limit(1);

      if (data.userId !== actor.id) {
        await notify(
          {
            userId: data.userId,
            kind: "task_assigned",
            title: `Added to ${project?.name ?? "a project"}`,
            body: `You are on this project as ${data.role.replace(/_/g, " ")}.`,
            projectId: data.projectId,
            dedupeKey: `member:${data.projectId}:${data.userId}`,
          },
          tx,
        );
      }
    });

    revalidatePath(`/projects/${data.projectId}`);
    return { ok: true, message: "Added to the project." };
  } catch (err) {
    return fail(err);
  }
}

export async function removeProjectMember(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
 try {
  const actor = await requireActor();
  assertCan(actor.globalRole, "project.manageMembers");

  const projectId = String(formData.get("projectId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  if (!projectId || !userId) throw new UserFacingError("Pick someone to remove.");
  await assertProjectAccess(actor, projectId);

  // Removing someone who still has open work orphans it silently, so the
  // action refuses and the UI shows why.
  const [{ open }] = await db
    .select({ open: sql<number>`count(*)::int` })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, projectId),
        eq(tasks.assigneeId, userId),
        ne(tasks.status, "done"),
      ),
    );
  // This used to `return;`, so the button did nothing and the reason lived
  // only in a title= tooltip on a disabled button — unreachable by keyboard
  // and invisible on touch.
  if (open > 0) {
    throw new UserFacingError(
      `They still have ${open} open task${open === 1 ? "" : "s"} here. Reassign those first.`,
    );
  }

  await db
    .delete(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, userId),
      ),
    );

  revalidatePath(`/projects/${projectId}`);
  return { ok: true, message: "Removed from the project." };
 } catch (err) {
  return { error: safeErrorMessage(err, "removeProjectMember") };
 }
}
