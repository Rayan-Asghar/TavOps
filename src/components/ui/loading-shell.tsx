import type { ReactNode } from "react";

/**
 * The app frame, drawn without data, for `loading.tsx`.
 *
 * `AppShell` cannot be reused here: it is async and awaits `cookies()`,
 * `getActor()` and `activeSessionFor()`, none of which a loading file can do —
 * a loading UI that suspends is not a loading UI. So the frame is reproduced
 * statically, and it has to match the real one exactly (248px rail, 56px
 * header) or the page lurches sideways the moment the content resolves.
 *
 * The sidebar silhouette is deliberately quiet rather than a row of grey bars:
 * the nav does not change between routes, so animating it implies work is
 * happening where none is. Only the content region is a skeleton.
 *
 * The whole thing is delayed 300ms (4.6 r42: under 1s should show no skeleton
 * at all), so a fast navigation never flashes it.
 */
export function LoadingShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen md:grid md:grid-cols-[248px_minmax(0,1fr)]">
      <aside
        aria-hidden
        className="hidden bg-nav px-3.5 py-4 md:sticky md:top-0 md:block md:h-screen"
      >
        <div className="flex min-h-[54px] items-center gap-2.5 px-1.5">
          <span className="grid h-9 w-9 place-items-center bg-brand text-xl font-bold text-white">
            T
          </span>
          <span className="flex flex-col gap-[5px] leading-none">
            <strong className="text-base tracking-[.08em] text-nav-fg">TAVREN</strong>
            <small className="text-2xs tracking-[.14em] text-nav-fg-subtle">
              INTERNAL OS
            </small>
          </span>
        </div>
      </aside>

      <div className="min-w-0">
        <header
          className="sticky top-0 z-30 flex h-[56px] items-center border-b border-border
                     bg-bg/90 pl-[72px] pr-5 backdrop-blur-md md:px-7"
        >
          <span
            role="status"
            aria-live="polite"
            className="text-2xs font-bold text-fg-muted"
          >
            Loading&hellip;
          </span>
        </header>

        <main className="p-5 md:p-7">
          {/* Delayed so a fast route never flashes a placeholder. */}
          <div className="animate-sk-appear">
            {children}
          </div>
        </main>
      </div>
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
