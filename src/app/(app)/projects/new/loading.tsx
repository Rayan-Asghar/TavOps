import { LoadingShell, LoadingIntro } from "@/components/ui/loading-shell";
import { Skeleton } from "@/components/ui/skeleton";

/* New project: a single form panel. Field heights match .field (44px). */
export default function Loading() {
  return (
    <LoadingShell>
      <LoadingIntro />
      <div className="panel max-w-[720px] p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i}>
              <Skeleton h={9} w="38%" />
              <div className="mt-2">
                <Skeleton h={44} rounded="md" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </LoadingShell>
  );
}
