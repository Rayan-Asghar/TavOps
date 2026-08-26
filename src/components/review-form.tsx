"use client";

import { useActionState, useState } from "react";
import { submitReview, type TaskState } from "@/server/tasks";

const initial: TaskState = {};

/** Approve outright, or send back with a reason. A rejection with no reason
 *  just guarantees another round trip, so the reason is required. */
export function ReviewForm({
  taskId,
  compact = false,
}: {
  taskId: string;
  compact?: boolean;
}) {
  const [state, action, pending] = useActionState(submitReview, initial);
  const [rejecting, setRejecting] = useState(false);
  const err = state.fieldErrors ?? {};

  if (state.ok && state.message) {
    return (
      <p className="rounded-lg bg-ok-soft px-3 py-1.5 text-[11px] font-bold text-ok">
        {state.message}
      </p>
    );
  }

  return (
    <form action={action} className={compact ? "flex flex-col gap-2" : "space-y-2"}>
      <input type="hidden" name="taskId" value={taskId} />

      {rejecting && (
        <div>
          <label className="sr-only" htmlFor={`c-${taskId}`}>
            What needs changing
          </label>
          <textarea
            id={`c-${taskId}`}
            name="comments"
            rows={2}
            required
            className="field"
            placeholder="What needs changing, specifically."
            aria-invalid={!!err.comments}
          />
          {err.comments && (
            <p role="alert" className="mt-1 text-[10px] text-danger">
              {err.comments}
            </p>
          )}
        </div>
      )}

      {state.error && !err.comments && (
        <p role="alert" className="text-[10px] text-danger">{state.error}</p>
      )}

      <div className="flex flex-wrap gap-2">
        {!rejecting ? (
          <>
            <button
              type="submit" name="decision" value="approved" disabled={pending}
              className="min-h-[32px] rounded-md bg-ok px-3 text-[11px] font-bold text-white"
            >
              {pending ? "…" : "Approve"}
            </button>
            <button
              type="button" onClick={() => setRejecting(true)}
              className="min-h-[32px] rounded-md border border-border px-3 text-[11px] font-bold text-fg"
            >
              Request changes
            </button>
          </>
        ) : (
          <>
            <button
              type="submit" name="decision" value="revision_needed" disabled={pending}
              className="min-h-[32px] rounded-md bg-danger px-3 text-[11px] font-bold text-white"
            >
              {pending ? "…" : "Send back"}
            </button>
            <button
              type="button" onClick={() => setRejecting(false)}
              className="min-h-[32px] px-2 text-[11px] font-bold text-fg-muted"
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </form>
  );
}
