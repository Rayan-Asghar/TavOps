import { setTheme } from "@/server/theme-actions";
import { THEMES, THEME_LABEL, type Theme } from "@/lib/theme";

/**
 * Three explicit choices rather than a cycling icon: on a cycling control you
 * cannot tell what the current state is without clicking it, and "Auto" is
 * otherwise unreachable once someone has picked a side.
 *
 * A plain form with three submit buttons, so it needs no client JavaScript.
 */
export function ThemeToggle({ current }: { current: Theme }) {
  return (
    <form
      action={setTheme}
      className="grid grid-cols-3 gap-0.5 rounded-lg bg-nav-hover p-0.5"
      aria-label="Colour theme"
    >
      {THEMES.map((t) => {
        const active = t === current;
        return (
          <button
            key={t}
            type="submit"
            name="theme"
            value={t}
            aria-pressed={active}
            className={`min-h-[26px] rounded-md text-2xs font-bold transition-[color,background-color,border-color] duration-150 ease-out-quad ${
              active
                ? "bg-nav-active text-nav-fg"
                : "text-nav-fg-subtle hover:text-nav-fg-muted"
            }`}
          >
            {THEME_LABEL[t]}
          </button>
        );
      })}
    </form>
  );
}
