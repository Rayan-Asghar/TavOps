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
  /** Defaults to 5s. Ignored for toasts that carry an undo or an error tone:
   *  those persist until dismissed (4.6 r45). Pass a number to force a timer. */
  durationMs?: number;
};

type Toast = ToastInput & { id: number; tone: ToastTone };

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

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
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

  /* A toast that carries an action must not time out, and a critical message must
     never be timer-dismissed (DESIGN-STANDARD 4.6 r45, from Carbon's notification
     pattern). This previously did the opposite of the rule: an Undo toast was given
     a LONGER timer (10s) rather than none, so the one toast whose action the user
     might still need was the one that expired while they were reading it. An error
     that appears only as a timed toast is also a [FAIL IF] -- errors stay until
     dismissed. Both now persist; everything routine still clears itself. */
  const persists = Boolean(toast.undo) || toast.tone === "error";
  const life = toast.durationMs ?? (persists ? null : 5_000);

  useEffect(() => {
    if (life === null) return;
    const id = window.setTimeout(onDismiss, life);
    return () => window.clearTimeout(id);
  }, [life, onDismiss]);

  return (
    <div
      className={`pointer-events-auto flex items-center gap-3 rounded-lg border px-3 py-2.5
                  shadow-sm ${
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
