"use client";

import { ActionButton } from "./ui";
import { unsnoozeNotificationAction } from "@/server/inbox-actions";

/** The way back out of the snoozed list — one click, no confirm (r21). */
export function UnsnoozeButton({ id, title }: { id: string; title: string }) {
  return (
    <ActionButton
      action={unsnoozeNotificationAction}
      fields={{ id }}
      className="btn-ghost btn-xs"
      title={`Bring back: ${title}`}
    >
      Bring back
    </ActionButton>
  );
}
