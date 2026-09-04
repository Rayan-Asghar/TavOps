import { LoadingShell, LoadingIntro } from "@/components/ui/loading-shell";
import { SkeletonMetrics, SkeletonRows } from "@/components/ui/skeleton";

/* Reports: four metric tiles over three tables. Row heights match the real ones (38 / 34). */
export default function Loading() {
  return (
    <LoadingShell>
      <LoadingIntro />
      <SkeletonMetrics />
      <section className="panel">
        <div className="panel-head" />
        <SkeletonRows rows={3} cols={8} rowH={38} />
      </section>
      <div className="h-4" />
      <section className="panel">
        <div className="panel-head" />
        <SkeletonRows rows={6} cols={5} rowH={38} />
      </section>
      <div className="h-4" />
      <section className="panel">
        <div className="panel-head" />
        <SkeletonRows rows={8} cols={6} rowH={34} />
      </section>

    </LoadingShell>
  );
}
