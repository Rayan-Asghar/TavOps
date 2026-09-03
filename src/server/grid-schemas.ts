import { z } from "zod";

/**
 * Validation and result types for the grid's batch save.
 *
 * Outside the `"use server"` modules for the reason `schemas.ts` gives: those
 * files may only export async functions, so a Zod object or a type exported
 * from one makes the whole action module fail to load. Keeping the result types
 * here too means a client component can import `RowOutcome` without pulling a
 * server module into its graph.
 */

/** The cells a rejection can be pinned to. */
export const GRID_FIELDS = [
  "workDate",
  "hours",
  "internalNotes",
  "taskId",
  "userId",
] as const;
export type GridField = (typeof GRID_FIELDS)[number];

const rowKey = z.string().min(1).max(64);
const hours = z.coerce
  .number()
  .min(0.01, "Log at least a minute.")
  .max(24, "That is more than a day.");
const internalNotes = z
  .string()
  .trim()
  .min(3, "Say what you did, even briefly.");
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date on this month's calendar.");

/**
 * One row of a save.
 *
 * The client declares the operation; the server never infers it from whether an
 * id is present. A paste that shifted by one row would otherwise overwrite the
 * wrong entries and create a duplicate at the end — the server verifies the
 * claim instead, and an `update` naming a row that is not there is reported as
 * missing rather than quietly promoted to a create.
 */
export const gridRowSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create"),
    rowKey,
    workDate: isoDate,
    hours,
    internalNotes,
    taskId: z.string().uuid().nullable().optional(),
    /** Whose entry it is. Defaults to the grid's person, then to the actor. */
    userId: z.string().uuid().nullable().optional(),
  }),
  z.object({
    op: z.literal("update"),
    rowKey,
    workLogId: z.string().uuid(),
    /** `work_logs.current_revision_id` as the client last saw it. */
    expectedRevisionId: z.string().uuid().nullable(),
    workDate: isoDate,
    hours,
    internalNotes,
    taskId: z.string().uuid().nullable().optional(),
  }),
  z.object({
    op: z.literal("remove"),
    rowKey,
    workLogId: z.string().uuid(),
    expectedRevisionId: z.string().uuid().nullable(),
  }),
]);

export type GridRowInput = z.infer<typeof gridRowSchema>;

/** A spreadsheet paste is bounded, for the transaction and the action body. */
export const GRID_BATCH_MAX = 200;

export const saveGridEnvelopeSchema = z.object({
  projectId: z.string().uuid(),
  /** The person filter in force, or null for a whole-project grid. */
  personId: z.string().uuid().nullable().optional(),
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick a month to save into."),
  /**
   * Optional for your own corrections, required the moment a row belongs to
   * somebody else — enforced in the row loop, because who owns a row is not
   * known at parse time.
   */
  reason: z.string().trim().min(3, "Say why this entry is changing.").optional(),
  rows: z
    .array(z.unknown())
    .min(1)
    .max(GRID_BATCH_MAX, `Save at most ${GRID_BATCH_MAX} rows at a time.`),
});

export type SaveGridEnvelope = z.infer<typeof saveGridEnvelopeSchema>;

export type RowOutcome =
  | {
      rowKey: string;
      status: "created" | "updated";
      workLogId: string;
      revisionId: string;
      version: number;
    }
  | { rowKey: string; status: "removed" | "unchanged"; workLogId: string }
  | {
      rowKey: string;
      status: "rejected";
      workLogId?: string;
      /** The cell to paint, or null for the whole row. */
      field: GridField | null;
      error: string;
    };

/**
 * Shape-compatible with `FormState`/`ActionState` — `ok`, `message` and `error`
 * mean the same things — so `FormError` and the toast helpers keep working, but
 * carrying the per-row detail a single-outcome type cannot.
 */
export type GridSaveState = {
  ok?: boolean;
  message?: string;
  error?: string;
  rows?: RowOutcome[];
  /** The month's authoritative total after the save, for the strip. */
  monthHours?: string;
};

/** Which cell a Zod issue belongs to, for painting one cell rather than a row. */
export function fieldFromPath(path: PropertyKey[]): GridField | null {
  const head = path[0];
  return typeof head === "string" &&
    (GRID_FIELDS as readonly string[]).includes(head)
    ? (head as GridField)
    : null;
}

/** "12 saved, 2 could not be." — said once, so every caller words it alike. */
export function summarise(rows: RowOutcome[]): string {
  const saved = rows.filter(
    (r) => r.status === "created" || r.status === "updated",
  ).length;
  const removed = rows.filter((r) => r.status === "removed").length;
  const rejected = rows.filter((r) => r.status === "rejected").length;

  const parts: string[] = [];
  if (saved) parts.push(`${saved} saved`);
  if (removed) parts.push(`${removed} removed`);
  if (rejected) parts.push(`${rejected} could not be`);
  if (parts.length === 0) return "Nothing to change.";
  return `${parts.join(", ")}.`;
}
