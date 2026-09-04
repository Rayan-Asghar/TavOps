"use client";

import { CloseIcon } from "../icons";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";

/**
 * Transient feedback for actions that have nowhere to put a message.
 *
 * Form-shaped work already reports inline through FormError/FormSuccess. Row
 * actions — dismiss, remove, deactivate, set lead — have no such space, which
 * is why they previously reported nothing at all: you clicked, and either the
 * row vanished or it did not, and both looked the same as a broken button.
 *
 * The live region is rendered unconditionally and empty, because a region that
 * appears at the same moment as its content is not reliably announced.
 */

export type ToastTone = "ok" | "error";

export type ToastUndo = {
  label?: string;
  run: () => Promise<unknown>;
};

export type ToastInput = {
  message: string;
  tone?: ToastTone;
  undo?: ToastUndo;
  /** Defaults to 2s, and pauses while the pointer or focus is on the toast so an
   *  Undo stays reachable. Errors ignore this and persist until dismissed
   *  (4.6 r45). Pass a number to override. */
  durationMs?: number;
};

type Toast = ToastInput & { id: number; tone: ToastTone; leaving?: boolean };

const ToastContext = createContext<((t: ToastInput) => void) | null>(null);

/** Push a toast. Safe to call outside a provider — it simply does nothing. */
export function useToast() {
  return useContext(ToastContext) ?? (() => {});
}

/**
 * Reports a useActionState result through the toast, once per result.
 *
 * For forms whose own layout has no room for an inline message — a select and
 * a button on one row — where the alternative is the silence these had before.
 */
export function useActionToast(
  state: { ok?: boolean; error?: string; message?: string },
) {
  const toast = useToast();
  const reported = useRef(state);

  useEffect(() => {
    if (state === reported.current) return;
    reported.current = state;
    if (state.error) toast({ message: state.error, tone: "error" });
    else if (state.ok && state.message) toast({ message: state.message });
  }, [state, toast]);
}

/** How long the exit animation runs. Must match `--animate-toast-out`. */
const EXIT_MS = 160;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  /* Dismissal is two-phase: mark it leaving so the row can animate out, then
     drop it once the animation has run. Removing the element immediately, which
     is what this did before, means there is nothing left to animate. */
  const dismiss = useCallback((id: number) => {
    setToasts((list) =>
      list.map((t) => (t.id === id ? { ...t, leaving: true } : t)),
    );
    window.setTimeout(
      () => setToasts((list) => list.filter((t) => t.id !== id)),
      EXIT_MS,
    );
  }, []);

  const push = useCallback((input: ToastInput) => {
    const id = nextId.current++;
    setToasts((list) => [...list, { ...input, id, tone: input.tone ?? "ok" }]);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        // Bottom-left, clear of the sidebar on desktop and of the thumb on a
        // phone. Pointer-events are off so it never eats a click on the page.
        className="pointer-events-none fixed bottom-4 left-4 right-4 z-[70] flex flex-col
                   gap-2 md:left-[264px] md:right-auto md:w-[380px]"
      >
        <div role="status" aria-live="polite" className="sr-only">
          {toasts.map((t) => (
            <span key={t.id}>{t.message}</span>
          ))}
        </div>
        {toasts.map((t) => (
          <ToastRow key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastRow({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: () => void;
}) {
  const [undoing, startUndo] = useTransition();
  /* Held while the pointer or keyboard focus is on the toast. */
  const [held, setHeld] = useState(false);

  /* Two seconds, which is what was asked for and is enough to read one line.
     Errors are the exception and stay until dismissed: r45 makes an error that
     appears only as a timed toast a [FAIL IF], and a message you looked away
     from for two seconds is a message you never got. Row actions have nowhere
     else to report a failure.

     The hold is what makes two seconds workable for an Undo. Reaching for the
     button stops the clock, so the shortest useful window is "as long as you are
     looking at it" rather than a fixed number -- and it restarts on leave. */
  const life = toast.durationMs ?? (toast.tone === "error" ? null : 2_000);

  useEffect(() => {
    if (life === null || held) return;
    const id = window.setTimeout(onDismiss, life);
    return () => window.clearTimeout(id);
  }, [life, held, onDismiss]);

  return (
    <div
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocusCapture={() => setHeld(true)}
      onBlurCapture={() => setHeld(false)}
      className={`pointer-events-auto flex items-center gap-3 rounded-lg border px-3 py-2.5
                  shadow-sm ${toast.leaving ? "animate-toast-out" : "animate-toast-in"} ${
                    toast.tone === "error"
                      ? "border-danger bg-danger-soft text-danger"
                      : "border-border bg-surface text-fg"
                  }`}
    >
      <span aria-hidden className="min-w-0 flex-1 text-xs font-medium">
        {toast.message}
      </span>

      {toast.undo && (
        <button
          type="button"
          disabled={undoing}
          onClick={() =>
            startUndo(async () => {
              await toast.undo?.run();
              onDismiss();
            })
          }
          className="btn-text shrink-0"
        >
          {undoing ? "Undoing…" : (toast.undo.label ?? "Undo")}
        </button>
      )}

      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-fg-muted
                   transition-[color,background-color] duration-150 ease-out-quad
                   hover:bg-surface-2 hover:text-fg"
      >
        <CloseIcon />
      </button>
    </div>
  );
}
