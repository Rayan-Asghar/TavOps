import { LoadingShell } from "@/components/ui/loading-shell";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";

/* Project detail: compact header, stat strip, tabs, then content beside the
   action rail. This page skips SectionIntro, so the skeleton does too. */
export default function Loading() {
  return (
    <LoadingShell>
      <div className="mb-5 mt-3.5">
        <Skeleton h={10} w="140px" />
        <div className="mt-3">
          <Skeleton h={28} w="46%" rounded="md" />
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="bg-surface px-4 py-3">
            <Skeleton h={9} w="60%" />
            <div className="mt-2">
              <Skeleton h={14} w="40%" />
            </div>
          </div>
        ))}
      </div>

      <div className="mb-5 flex gap-6 border-b border-border pb-3">
        {["72px", "58px", "64px", "50px"].map((w) => (
          <Skeleton key={w} h={10} w={w} />
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="panel">
          <div className="panel-head" />
          <SkeletonRows rows={6} cols={4} rowH={44} />
        </section>
        <aside className="panel h-[280px] p-5">
          <Skeleton h={10} w="50%" />
          <div className="mt-4">
            <Skeleton h={40} rounded="md" />
          </div>
        </aside>
      </div>
    </LoadingShell>
  );
}
