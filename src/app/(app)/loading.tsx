import { LoadingShell, LoadingIntro } from "@/components/ui/loading-shell";
import { SkeletonMetrics, SkeletonRows } from "@/components/ui/skeleton";

/* Needs attention: four tiles over the priority queue. Queue rows are 76px (.attention-row). */
export default function Loading() {
  return (
    <LoadingShell>
      <LoadingIntro />
      <SkeletonMetrics />
      <section className="panel">
        <div className="panel-head" />
        <SkeletonRows rows={4} cols={3} rowH={76} />
      </section>

    </LoadingShell>
  );
}
