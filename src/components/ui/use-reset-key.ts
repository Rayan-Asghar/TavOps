"use client";

import { useState } from "react";

/**
 * A key that changes only after a *successful* submit, so a form clears when
 * it worked and keeps what you typed when it did not.
 *
 * Replaces `key={state.ok ? "created" : "new"}`, which flipped exactly once:
 * a second consecutive create left the previous values in the fields, and an
 * error arriving after a success flipped the key back and wiped the form the
 * user was being asked to correct.
 *
 * Adjusts state during render rather than in an effect — the documented way to
 * derive state from a changed input, and it re-renders before the browser
 * paints instead of after.
 */
export function useResetKey(state: { ok?: boolean }): number {
  const [seen, setSeen] = useState(state);
  const [key, setKey] = useState(0);

  if (state !== seen) {
    setSeen(state);
    if (state.ok) setKey((n) => n + 1);
  }

  return key;
}
