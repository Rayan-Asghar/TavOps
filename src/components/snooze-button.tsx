"use client";

import { useState } from "react";
import { ActionButton } from "./ui";
import {
  snoozeNotificationAction,
  unsnoozeNotificationAction,
} from "@/server/inbox-actions";
import { TimerIcon } from "./icons";

/**
 * Snooze — the exit DESIGN-STANDARD 2.1 calls "the highest-value single borrow",
 * because it is what lets the queue be honestly empty without losing anything.
 *
 * Three presets, not a date picker: the real question is "later today, tomorrow,
 * or next week", and a calendar makes a two-second decision into a ten-second
 * one. r21 forbids a confirm step on a routine action, so there is no dialog —
 * the toast carries undo instead, and the item is only hidden, never resolved.
 *
 * The choices open on click rather than hover (r8: submenus are click-activated),
 * and every one is a real button, so the whole control is reachable by keyboard.
 */

const CHOICES: { key: string; label: string }[] = [
  { key: "3h", label: "In 3 hours" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "week", label: "Next week" },
];

export function SnoozeButton({ id, title }: { id: string; title: string }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        title={`Snooze: ${title}`}
        className="btn-ghost btn-sm gap-1.5"
      >
        <TimerIcon />
        Snooze
      </button>
    );
  }

  return (
    <span className="flex items-center gap-1" role="group" aria-label={`Snooze ${title} until`}>
      {CHOICES.map((c) => (
        <ActionButton
          key={c.key}
          action={snoozeNotificationAction}
          fields={{ id, until: c.key }}
          className="btn-secondary btn-xs"
          title={`Snooze until ${c.label.toLowerCase()}`}
          undo={(state) =>
            state.undoToken
              ? {
                  label: "Bring it back",
                  run: async () => {
                    const fd = new FormData();
                    fd.set("id", state.undoToken as string);
                    await unsnoozeNotificationAction({}, fd);
                  },
                }
              : undefined
          }
        >
          {c.label}
        </ActionButton>
      ))}
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="btn-ghost btn-xs"
        aria-label="Cancel snooze"
      >
        Cancel
      </button>
    </span>
  );
}
