import { LoadingShell, LoadingIntro } from "@/components/ui/loading-shell";
import { SkeletonRows, Skeleton } from "@/components/ui/skeleton";

/* Timesheet: filters, month tabs, totals strip, then the 32px grid. */
export default function Loading() {
  return (
    <LoadingShell>
      <LoadingIntro />
      <div className="mb-5 flex gap-3">
        <Skeleton w="260px" h={40} rounded="md" />
        <Skeleton w="180px" h={40} rounded="md" />
      </div>
      <div className="mb-5 grid grid-cols-3 gap-px overflow-hidden rounded-[14px] border border-border bg-border">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-surface p-4">
            <Skeleton h={10} w="50%" />
            <div className="mt-2">
              <Skeleton h={16} w="34%" />
            </div>
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-[14px] border border-border">
        <SkeletonRows rows={10} cols={5} rowH={32} />
      </div>

    </LoadingShell>
  );
}
