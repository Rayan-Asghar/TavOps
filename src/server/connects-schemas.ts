import { z } from "zod";

/**
 * Shapes for the connect ledger writers.
 *
 * A plain module, not `"use server"`, for the same reason `proposal-schemas.ts`
 * is: a server-action module may only export async functions, so nothing
 * testable or constant can live beside the actions.
 */

export const LEDGER_KINDS = [
  "purchase",
  "grant",
  "bid",
  "boost",
  "refund",
  "expiry",
  "reconcile",
] as const;

export type LedgerKind = (typeof LEDGER_KINDS)[number];

/** The kinds a person records by hand. `bid`/`boost` ride on logging a bid. */
export const MANUAL_KINDS = [
  "purchase",
  "grant",
  "refund",
  "expiry",
] as const satisfies readonly LedgerKind[];

export const KIND_LABEL: Record<LedgerKind, string> = {
  purchase: "Bought",
  grant: "Free monthly",
  bid: "Bid",
  boost: "Boosted",
  refund: "Refunded",
  expiry: "Expired",
  reconcile: "Reconciled",
};

/** Which way each kind moves the balance. Mirrors the CHECK in 0023. */
export const KIND_SIGN: Record<LedgerKind, 1 | -1 | 0> = {
  purchase: 1,
  grant: 1,
  refund: 1,
  bid: -1,
  boost: -1,
  expiry: -1,
  // A reconcile goes either way — that is what makes it a reconcile.
  reconcile: 0,
};

/**
 * Recording connects arriving or aging out.
 *
 * `amountUsd` is accepted only for a purchase and converted to cents by the
 * action. The database refuses money on any other kind; this refuses it one
 * layer earlier so the rep is told which field rather than handed a constraint
 * violation.
 */
export const recordConnectsSchema = z
  .object({
    kind: z.enum(MANUAL_KINDS),
    count: z.coerce.number().int().positive("How many connects?").max(100_000),
    amountUsd: z.coerce.number().min(0).max(100_000).optional(),
    occurredAt: z.coerce.date().optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.kind !== "purchase" || (v.amountUsd ?? 0) > 0, {
    message: "What did it cost?",
    path: ["amountUsd"],
  })
  .refine((v) => v.kind === "purchase" || v.amountUsd === undefined, {
    message: "Only a purchase has a price.",
    path: ["amountUsd"],
  });

/**
 * Squaring the ledger against the number Upwork actually shows.
 *
 * The note is required, and that is the point of the whole entry: the drift is
 * not hidden, it IS the delta on this row, and a drift with no explanation is a
 * number nobody can audit six months later. The database enforces it too.
 */
export const reconcileConnectsSchema = z.object({
  actual: z.coerce.number().int().min(0).max(1_000_000),
  note: z.string().trim().min(3, "What happened? Even 'free monthly' helps."),
});

/** Connects spent placing one bid, written with the proposal in one go. */
export const bidCostSchema = z.object({
  connects: z.coerce.number().int().min(0).max(500).optional(),
  boost: z.coerce.number().int().min(0).max(500).optional(),
});
