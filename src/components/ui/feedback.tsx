import type { ReactNode } from "react";

/**
 * Form feedback, in one place.
 *
 * There used to be nine copies of the error banner in three sizes, five sizes
 * of field error, and twelve success banners of which only two announced
 * themselves to a screen reader. The live-region roles are the point of these
 * components: `role="alert"` interrupts, `role="status"` waits its turn.
 */

/** Whole-form failure. Interrupts, because the submit did not happen. */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="m-0 rounded-lg bg-danger-soft px-3 py-2 text-xs font-medium text-danger"
    >
      {children}
    </p>
  );
}

/** Whole-form success. Announced politely rather than interrupting. */
export function FormSuccess({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="m-0 rounded-lg bg-ok-soft px-3 py-2 text-xs font-medium text-ok"
    >
      {children}
    </p>
  );
}

/**
 * Error belonging to one field. Give it an `id` and point the input's
 * `aria-describedby` at it, so the message is read with the field rather than
 * being stranded next to it.
 */
export function FieldError({
  id,
  children,
}: {
  id?: string;
  children: ReactNode;
}) {
  return (
    <p id={id} className="m-0 mt-1 text-2xs font-medium text-danger">
      {children}
    </p>
  );
}
