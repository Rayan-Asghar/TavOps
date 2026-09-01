"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useToast, type ToastUndo } from "./toast";
import type { ActionState } from "@/lib/action-state";

export type { ActionState };

/**
 * A one-click server action with the three things the bare `<form action={fn}>`
 * call sites were all missing: a pending state, a failure that reaches the
 * user, and a confirmation that anything happened at all.
 *
 * Deliberately NOT useActionState. Most of these actions delete the row they
 * live in, so on success the button unmounts during revalidation and any
 * effect watching the returned state never runs — the success was reported to
 * a component that no longer existed. Awaiting inside a transition keeps the
 * result in a closure instead, and `toast` belongs to the provider up in the
 * shell, which is still mounted when the row goes.
 *
 * Row actions report through the toast rather than inline, because a table
 * cell or a list row has nowhere to put a message without reflowing the row.
 */
export function ActionButton({
  action,
  fields,
  children,
  className = "btn-secondary btn-sm",
  pendingLabel = "…",
  confirm,
  disabled,
  title,
  quiet = false,
  undo,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  /** Sent as form fields. */
  fields?: Record<string, string>;
  children: ReactNode;
  className?: string;
  pendingLabel?: ReactNode;
  /** Turns the button into a two-step confirm with this label. */
  confirm?: string;
  disabled?: boolean;
  title?: string;
  /** Suppress the success toast — for actions whose result is self-evident. */
  quiet?: boolean;
  /** Offer an undo in the success toast, built from the returned state. */
  undo?: (state: ActionState) => ToastUndo | undefined;
}) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const toast = useToast();

  const run = () => {
    const formData = new FormData();
    for (const [name, value] of Object.entries(fields ?? {})) {
      formData.set(name, value);
    }

    startTransition(async () => {
      const state = await action({}, formData);
      setConfirming(false);

      if (state.error) {
        toast({ message: state.error, tone: "error" });
      } else if (state.ok && !quiet) {
        toast({ message: state.message ?? "Done.", undo: undo?.(state) });
      }
    });
  };

  if (confirm && !confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={disabled}
        title={title}
        className={className}
      >
        {children}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={pending || disabled}
        title={title}
        className={className}
      >
        {pending ? pendingLabel : (confirm ?? children)}
      </button>
      {confirm && (
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="btn-ghost btn-sm"
        >
          Cancel
        </button>
      )}
    </span>
  );
}
