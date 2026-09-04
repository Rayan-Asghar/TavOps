import { setDensity } from "@/server/density-actions";
import { DENSITIES, DENSITY_LABEL, type Density } from "@/lib/density";

/**
 * Two explicit choices, like `ThemeToggle` — you can read the current state
 * without clicking. A plain form with submit buttons, so it needs no JavaScript.
 */
export function DensityToggle({ current }: { current: Density }) {
  return (
    <form
      action={setDensity}
      className="inline-grid grid-cols-2 gap-0.5 rounded-lg border border-border bg-surface p-0.5"
      aria-label="List density"
    >
      {DENSITIES.map((d) => {
        const active = d === current;
        return (
          <button
            key={d}
            type="submit"
            name="density"
            value={d}
            aria-pressed={active}
            className={`min-h-[28px] rounded-md px-2.5 text-2xs font-bold transition-[color,background-color] duration-150 ease-out-quad ${
              active
                ? "bg-fill-strong text-fill-strong-fg"
                : "text-fg-muted hover:text-fg"
            }`}
          >
            {DENSITY_LABEL[d]}
          </button>
        );
      })}
    </form>
  );
}
