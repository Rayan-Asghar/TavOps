"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  deleteViewAction,
  saveViewAction,
} from "@/server/saved-view-actions";
import type { SavedViewRow } from "@/server/saved-view-queries";
import { FormError } from "./ui";
import type { ActionState } from "@/lib/action-state";

const initial: ActionState = {};

/**
 * Named links to a filtered screen.
 *
 * Cheap only because every list here keeps its filters in the query string: a
 * view is a name and a URL, so there is no filter format to design and no way
 * for a saved view to drift from the screen it was saved from.
 */
export function SavedViews({
  path,
  currentQuery,
  views,
}: {
  path: string;
  /** The query string of the page as rendered, without its `?`. */
  currentQuery: string;
  views: SavedViewRow[];
}) {
  const [saveState, save, saving] = useActionState(saveViewAction, initial);
  const [delState, remove] = useActionState(deleteViewAction, initial);
  const [naming, setNaming] = useState(false);

  const active = (q: string) => q === currentQuery;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {views.map((v) => (
        <span
          key={v.id}
          className={`inline-flex items-center rounded-lg border text-xs ${
            active(v.query)
              ? "border-brand bg-surface-2"
              : "border-border bg-surface"
          }`}
        >
          <Link
            href={v.query ? `${path}?${v.query}` : path}
            className="px-3 py-2 font-bold hover:text-brand"
          >
            {v.name}
            {v.isShared && (
              <span className="ml-1.5 text-2xs font-normal text-fg-subtle">
                shared
              </span>
            )}
          </Link>
          {/* Only your own views are removable — including a shared one you
              created. Somebody else's shared view is not yours to delete. */}
          {v.isMine && (
            <form action={remove}>
              <input type="hidden" name="id" value={v.id} />
              <button
                type="submit"
                aria-label={`Remove saved view ${v.name}`}
                className="px-2 py-2 text-fg-subtle hover:text-danger"
              >
                ×
              </button>
            </form>
          )}
        </span>
      ))}

      {naming ? (
        <form action={save} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="path" value={path} />
          <input type="hidden" name="query" value={currentQuery} />
          <input
            name="name"
            required
            autoFocus
            maxLength={80}
            placeholder="Name this view"
            aria-label="Saved view name"
            className="field h-11 w-[180px] py-0"
          />
          <label className="flex items-center gap-1.5 text-2xs text-fg-muted">
            <input type="checkbox" name="isShared" className="h-4 w-4" />
            Share with the team
          </label>
          <button type="submit" disabled={saving} className="btn-secondary btn-sm">
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => setNaming(false)}
            className="btn-ghost btn-sm"
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setNaming(true)}
          className="btn-ghost btn-sm"
        >
          + Save this view
        </button>
      )}

      {saveState.error && <FormError>{saveState.error}</FormError>}
      {delState.error && <FormError>{delState.error}</FormError>}
    </div>
  );
}
