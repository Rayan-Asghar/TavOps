import type { ReactNode } from "react";

/**
 * The delayed wrapper around a page's loading skeleton.
 *
 * It used to redraw the whole application frame — sidebar, header, the lot —
 * because the shell lived inside each page and a `loading.tsx` replacing that
 * page took the frame with it. Now the shell is a layout, `loading.tsx` renders
 * into its content slot, and drawing a frame here produced two sidebars and two
 * headers stacked inside each other (measured: `asides: 2, headers: 2`).
 *
 * So this is content-only. The real sidebar and header stay on screen and keep
 * working while the page loads, which is the whole point of moving them.
 *
 * The 300ms delay stays: 4.6 r42 says a load under a second should show no
 * skeleton at all, and Next renders `loading.tsx` the instant navigation starts.
 */
export function LoadingShell({ children }: { children: ReactNode }) {
  return (
    <div className="animate-sk-appear" role="status" aria-label="Loading">
      {children}
    </div>
  );
}

/** The page heading block, at the height `SectionIntro` actually occupies. */
export function LoadingIntro() {
  return (
    <div className="mb-7 mt-3.5 border-b border-fg pb-6 pt-6">
      <span className="mb-2 block h-3 w-[180px] rounded-sm bg-surface-2" aria-hidden />
      <span className="block h-[38px] w-[42%] rounded-md bg-surface-2" aria-hidden />
    </div>
  );
}
