import { LoadingShell, LoadingIntro } from "@/components/ui/loading-shell";
import { SkeletonMetrics, SkeletonRows } from "@/components/ui/skeleton";

/* Review queue: four tiles over submission cards. */
export default function Loading() {
  return (
    <LoadingShell>
      <LoadingIntro />
      <SkeletonMetrics />
      <section className="panel">
        <div className="panel-head" />
        <SkeletonRows rows={3} cols={3} rowH={92} />
      </section>

    </LoadingShell>
  );
}
