"use client";

import { ActionButton } from "./ui";
import {
  dismissNotification,
  undismissNotification,
} from "@/server/inbox-actions";

/**
 * Dismissing was irreversible from the UI and reported nothing: the row either
 * vanished or it did not. Now it says so, and gives you ten seconds to change
 * your mind — the item is only marked resolved, so putting it back is cheap.
 */
export function DismissButton({ id, title }: { id: string; title: string }) {
  return (
    <ActionButton
      action={dismissNotification}
      fields={{ id }}
      className="btn-ghost btn-sm btn-ghost-danger"
      title={`Dismiss: ${title}`}
      undo={(state) =>
        state.undoToken
          ? {
              run: async () => {
                const fd = new FormData();
                fd.set("id", state.undoToken as string);
                await undismissNotification({}, fd);
              },
            }
          : undefined
      }
    >
      Dismiss
    </ActionButton>
  );
}
