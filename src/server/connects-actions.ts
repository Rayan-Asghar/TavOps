"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { connectLedger } from "@/db/schema";
import { requireActor } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { KIND_SIGN, recordConnectsSchema, reconcileConnectsSchema } from "./connects-schemas";
import { connectsBalance } from "./connects-queries";
import { writeAudit } from "./audit";
import { safeErrorMessage } from "./action-errors";

/**
 * Writers for the connect ledger.
 *
 * Every one of them audits in the same transaction as the row it writes. This
 * table is deliberately NOT `REVOKE`d the way `audit_log` is — a fat-fingered
 * 60 that can never be corrected buys nothing, and this is an operational count
 * we keep about a system we do not control. The guarantee comes from the audit
 * trail instead, which is the table that IS revoked.
 */

export type ConnectsState = {
  ok?: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
};

function toState(err: unknown): ConnectsState {
  if (err instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const i of err.issues) {
      const k = String(i.path[0] ?? "_");
      if (!fieldErrors[k]) fieldErrors[k] = i.message;
    }
    return { error: "Check the highlighted fields.", fieldErrors };
  }
  return { error: safeErrorMessage(err, "connects") };
}

function revalidate() {
  revalidatePath("/sales/connects");
  revalidatePath("/sales");
  revalidatePath("/");
}

/** Connects bought, granted, refunded or expired. */
export async function recordConnects(
  _prev: ConnectsState,
  formData: FormData,
): Promise<ConnectsState> {
  try {
    const actor = await requireActor();
    assertCan(actor.globalRole, "connects.manage");

    const data = recordConnectsSchema.parse({
      kind: String(formData.get("kind") ?? ""),
      count: formData.get("count"),
      amountUsd: formData.get("amountUsd") || undefined,
      occurredAt: formData.get("occurredAt") || undefined,
      note: formData.get("note") || undefined,
    });

    // The sign belongs to the kind, not to whoever is typing. The database
    // says the same thing in a CHECK; this is so the form cannot get there.
    const delta = data.count * KIND_SIGN[data.kind];

    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(connectLedger)
        .values({
          kind: data.kind,
          delta,
          occurredAt: data.occurredAt,
          amountCents:
            data.kind === "purchase" ? Math.round((data.amountUsd ?? 0) * 100) : null,
          recordedById: actor.id,
          note: data.note,
        })
        .returning({ id: connectLedger.id });

      await writeAudit(tx, {
        actorId: actor.id,
        entityType: "connect_ledger",
        entityId: row.id,
        action: "connects.record",
        after: { kind: data.kind, delta, amountUsd: data.amountUsd ?? null },
      });
    });

    revalidate();
    return { ok: true, message: `Recorded ${Math.abs(delta)} connects.` };
  } catch (err) {
    return toState(err);
  }
}

/**
 * Squares the ledger against the number Upwork actually shows.
 *
 * Drift is guaranteed, not a defect: Upwork grants connects nobody records,
 * refunds its own and expires the rest. Pretending otherwise turns the balance
 * into fiction and the low-balance alert into something people mute. So the
 * drift is not silently absorbed — it becomes one row whose delta IS the drift,
 * with a required note, and `sum(abs(delta)) filter (where kind='reconcile')`
 * then measures how far this ledger runs from reality.
 */
export async function reconcileConnects(
  _prev: ConnectsState,
  formData: FormData,
): Promise<ConnectsState> {
  try {
    const actor = await requireActor();
    assertCan(actor.globalRole, "connects.manage");

    const data = reconcileConnectsSchema.parse({
      actual: formData.get("actual"),
      note: formData.get("note") ?? "",
    });

    const result = await db.transaction(async (tx) => {
      // Read inside the transaction: a bid landing between the read and the
      // write would otherwise be reconciled away.
      const derived = await connectsBalance(tx);
      const drift = data.actual - derived;
      if (drift === 0) return { drift, wrote: false };

      const [row] = await tx
        .insert(connectLedger)
        .values({
          kind: "reconcile",
          delta: drift,
          recordedById: actor.id,
          note: data.note,
        })
        .returning({ id: connectLedger.id });

      await writeAudit(tx, {
        actorId: actor.id,
        entityType: "connect_ledger",
        entityId: row.id,
        action: "connects.reconcile",
        before: { balance: derived },
        after: { balance: data.actual, drift },
      });
      return { drift, wrote: true };
    });

    revalidate();
    if (!result.wrote) {
      return { ok: true, message: "Already square — nothing to record." };
    }
    return {
      ok: true,
      message: `Reconciled: we were ${Math.abs(result.drift)} ${
        result.drift > 0 ? "short" : "over"
      }.`,
    };
  } catch (err) {
    return toState(err);
  }
}
