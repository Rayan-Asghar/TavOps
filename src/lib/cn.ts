import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Class merger for the component layer.
 *
 * `twMerge` resolves conflicts between Tailwind utilities so a caller's
 * `className` can override a component's default rather than fighting it on
 * source order. It is configured against Tailwind's stock theme, which this
 * project mostly does not use — `text-2xs`, `rounded-panel` and the semantic
 * colour utilities are unknown to it and pass through untouched. That is the
 * correct behaviour for them: unknown classes are never dropped, only conflicts
 * between recognised ones are resolved. Keep it in mind before relying on it to
 * dedupe a custom utility.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
