import { LoadingShell, LoadingIntro } from "@/components/ui/loading-shell";
import { SkeletonRows } from "@/components/ui/skeleton";

/* Log work: two panels of expandable task rows (56px). */
export default function Loading() {
  return (
    <LoadingShell>
      <LoadingIntro />
      <section className="panel">
        <div className="panel-head" />
        <SkeletonRows rows={5} cols={3} rowH={56} />
      </section>
      <div className="h-4" />
      <section className="panel">
        <div className="panel-head" />
        <SkeletonRows rows={5} cols={3} rowH={56} />
      </section>

    </LoadingShell>
  );
}
