"use client";

import { useActionState, useState } from "react";
import { submitReview, type TaskState } from "@/server/tasks";
import { FormSuccess } from "@/components/ui";

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
      <FormSuccess>{state.message}</FormSuccess>
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
            <p role="alert" className="mt-1 text-xs text-danger">
              {err.comments}
            </p>
          )}
        </div>
      )}

      {state.error && !err.comments && (
        <p role="alert" className="text-xs text-danger">{state.error}</p>
      )}

      <div className="flex flex-wrap gap-2">
        {!rejecting ? (
          <>
            <button
              type="submit" name="decision" value="approved" disabled={pending}
              className="btn-ok btn-sm"
            >
              {pending ? "…" : "Approve"}
            </button>
            <button
              type="button" onClick={() => setRejecting(true)}
              className="btn-secondary btn-sm"
            >
              Request changes
            </button>
          </>
        ) : (
          <>
            <button
              type="submit" name="decision" value="revision_needed" disabled={pending}
              className="btn-danger btn-sm"
            >
              {pending ? "…" : "Send back"}
            </button>
            <button
              type="button" onClick={() => setRejecting(false)}
              className="btn-ghost btn-sm"
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </form>
  );
}
