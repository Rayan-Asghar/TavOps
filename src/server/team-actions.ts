"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { auditLog, teamMembers, teams } from "@/db/schema";
import { requireActor } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { safeErrorMessage } from "./action-errors";

export type TeamState = {
  ok?: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
};

const createTeamSchema = z.object({
  name: z.string().trim().min(2, "Give the team a name."),
  leadId: z.string().uuid("Pick a lead."),
  discipline: z.string().trim().max(60).optional(),
});

function toState(err: unknown): TeamState {
  if (err instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const i of err.issues) {
      const k = String(i.path[0] ?? "_");
      if (!fieldErrors[k]) fieldErrors[k] = i.message;
    }
    return { error: "Check the highlighted fields.", fieldErrors };
  }
  // Translate the unique-name collision into something a person can act on,
  // before the generic handler reduces it to a reference number.
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes("teams_name_unique")) {
    return { error: "A team with that name already exists." };
  }
  return { error: safeErrorMessage(err, "team") };
}

export async function createTeam(
  _prev: TeamState,
  formData: FormData,
): Promise<TeamState> {
  try {
    const actor = await requireActor();
    assertCan(actor.globalRole, "team.manage");

    const data = createTeamSchema.parse({
      name: formData.get("name"),
      leadId: formData.get("leadId"),
      discipline: formData.get("discipline") ?? undefined,
    });

    await db.transaction(async (tx) => {
      const [team] = await tx.insert(teams).values(data).returning();
      // The lead is a member of their own team, so queries that ask "who is in
      // this team" do not have to special-case them.
      await tx
        .insert(teamMembers)
        .values({ teamId: team.id, userId: data.leadId })
        .onConflictDoNothing();
      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: "team.create",
        entityType: "team",
        entityId: team.id,
        detail: { name: data.name },
      });
    });

    revalidatePath("/admin/teams");
    return { ok: true, message: "Team created." };
  } catch (err) {
    return toState(err);
  }
}

export async function addTeamMember(formData: FormData) {
  const actor = await requireActor();
  assertCan(actor.globalRole, "team.manage");
  const teamId = String(formData.get("teamId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  if (!teamId || !userId) return;

  await db.insert(teamMembers).values({ teamId, userId }).onConflictDoNothing();
  revalidatePath("/admin/teams");
}

export async function removeTeamMember(formData: FormData) {
  const actor = await requireActor();
  assertCan(actor.globalRole, "team.manage");
  const teamId = String(formData.get("teamId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  if (!teamId || !userId) return;

  const [team] = await db
    .select({ leadId: teams.leadId })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  // Removing the lead from their own team would orphan routing for everyone
  // else in it, so it is refused rather than silently allowed.
  if (team?.leadId === userId) return;

  await db
    .delete(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
  revalidatePath("/admin/teams");
}

export async function setTeamLead(formData: FormData) {
  const actor = await requireActor();
  assertCan(actor.globalRole, "team.manage");
  const teamId = String(formData.get("teamId") ?? "");
  const leadId = String(formData.get("leadId") ?? "");
  if (!teamId || !leadId) return;

  await db.transaction(async (tx) => {
    await tx.update(teams).set({ leadId }).where(eq(teams.id, teamId));
    await tx
      .insert(teamMembers)
      .values({ teamId, userId: leadId })
      .onConflictDoNothing();
    await tx.insert(auditLog).values({
      actorId: actor.id,
      action: "team.set_lead",
      entityType: "team",
      entityId: teamId,
      detail: { leadId },
    });
  });
  revalidatePath("/admin/teams");
}

export async function deleteTeam(formData: FormData) {
  const actor = await requireActor();
  assertCan(actor.globalRole, "team.manage");
  const teamId = String(formData.get("teamId") ?? "");
  if (!teamId) return;
  await db.delete(teams).where(eq(teams.id, teamId));
  revalidatePath("/admin/teams");
}
