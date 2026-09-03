import { LoadingShell, LoadingIntro } from "@/components/ui/loading-shell";
import { SkeletonMetrics, SkeletonRows } from "@/components/ui/skeleton";

/* Sales: four tiles, then the proposal list beside the entry rail. */
export default function Loading() {
  return (
    <LoadingShell>
      <LoadingIntro />
      <SkeletonMetrics />
      <section className="panel">
        <div className="panel-head" />
        <SkeletonRows rows={6} cols={4} rowH={44} />
      </section>

    </LoadingShell>
  );
}
