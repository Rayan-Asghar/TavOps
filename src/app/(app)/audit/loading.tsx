import { LoadingShell, LoadingIntro } from "@/components/ui/loading-shell";
import { SkeletonRows } from "@/components/ui/skeleton";

/* Audit log: a long flat list, 50 to a page. */
export default function Loading() {
  return (
    <LoadingShell>
      <LoadingIntro />
      <section className="panel">
        <div className="panel-head" />
        <SkeletonRows rows={12} cols={4} rowH={44} />
      </section>

    </LoadingShell>
  );
}
