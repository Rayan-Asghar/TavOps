"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Keeps a half-finished form alive across navigation.
 *
 * DESIGN-STANDARD 4.4 r32 makes losing one a `[FAIL IF]`: interrupted entry has
 * to survive, and people must be able to "skip ahead, loop back… and move fluidly
 * from any step to any other" without losing progress. On a two-person ops team
 * every entry is interrupted — someone types three words of a work-log note, gets
 * asked something, clicks away, and comes back to an empty box.
 *
 * `localStorage`, not a server draft: this is one person's unsent text on one
 * machine, it must survive a hard reload rather than only a client-side
 * navigation, and a round trip per keystroke would be absurd for it.
 *
 * Deliberately excluded: passwords, and anything the browser is already
 * restoring itself. Every read and write is wrapped — Safari private mode throws
 * on `localStorage` access rather than returning null, and a form that cannot
 * save a draft must still work.
 *
 * Returns a **callback ref**, not a plain object ref, and that is load-bearing:
 * `/log` only mounts its form when a row is expanded, so an effect keyed on a
 * RefObject runs once against `null`, finds nothing, and never fires again. A
 * callback ref re-runs the moment the node actually attaches.
 */
export function useFormDraft(
  key: string,
  /** Set true once the action succeeds, so the draft is dropped rather than
   *  restored over the next blank form. */
  submitted: boolean,
) {
  const [form, setForm] = useState<HTMLFormElement | null>(null);
  const formRef = useCallback((node: HTMLFormElement | null) => {
    setForm(node);
  }, []);
  const storageKey = `tavren:draft:${key}`;
  const restored = useRef(false);

  const clear = useCallback(() => {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Storage unavailable. Nothing was saved, so nothing needs clearing.
    }
  }, [storageKey]);

  // Restore once the form exists, before the user starts typing.
  useEffect(() => {
    if (!form || restored.current) return;
    restored.current = true;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as Record<string, string>;
      for (const [name, value] of Object.entries(saved)) {
        const el = form.elements.namedItem(name);
        if (
          (el instanceof HTMLInputElement ||
            el instanceof HTMLTextAreaElement ||
            el instanceof HTMLSelectElement) &&
          el.type !== "password" &&
          el.type !== "hidden" &&
          !el.value
        ) {
          el.value = value;
        }
      }
    } catch {
      // Corrupt or unavailable. A missing draft is not worth an error.
    }
  }, [form, storageKey]);

  // Save on input. No debounce: this is a handful of short fields, and a
  // debounce is exactly what loses the last few characters on a fast exit.
  useEffect(() => {
    if (!form) return;

    const save = () => {
      try {
        const data: Record<string, string> = {};
        for (const el of Array.from(form.elements)) {
          if (
            (el instanceof HTMLInputElement ||
              el instanceof HTMLTextAreaElement ||
              el instanceof HTMLSelectElement) &&
            el.name &&
            el.type !== "password" &&
            el.type !== "hidden" &&
            el.value
          ) {
            data[el.name] = el.value;
          }
        }
        if (Object.keys(data).length === 0) clear();
        else window.localStorage.setItem(storageKey, JSON.stringify(data));
      } catch {
        // Quota or private mode. Losing the draft is bad; breaking typing is worse.
      }
    };

    form.addEventListener("input", save);
    form.addEventListener("change", save);
    return () => {
      form.removeEventListener("input", save);
      form.removeEventListener("change", save);
    };
  }, [form, storageKey, clear]);

  // A saved entry is no longer a draft.
  useEffect(() => {
    if (submitted) clear();
  }, [submitted, clear]);

  return { formRef, form, clear };
}
