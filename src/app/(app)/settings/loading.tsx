import { LoadingShell, LoadingIntro } from "@/components/ui/loading-shell";
import { Skeleton } from "@/components/ui/skeleton";

/* Projects: a responsive card grid, not a table. */
export default function Loading() {
  return (
    <LoadingShell>
      <LoadingIntro />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="panel p-5">
            <Skeleton h={10} w="34%" />
            <div className="mt-4">
              <Skeleton h={18} w="76%" rounded="md" />
            </div>
            <div className="mt-4">
              <Skeleton h={10} w="90%" />
            </div>
            <div className="mt-5">
              <Skeleton h={5} />
            </div>
          </div>
        ))}
      </div>

    </LoadingShell>
  );
}
