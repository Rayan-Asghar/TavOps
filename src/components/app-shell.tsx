import type { ReactNode } from "react";
/** Large heading block that opens a page, matching the reference's section rule. */
export function SectionIntro({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-7 mt-3.5 flex flex-col items-start justify-between gap-5 border-b border-fg pb-6 pt-6 sm:flex-row sm:items-end">
      <div className="min-w-0">
        <p className="eyebrow">{eyebrow}</p>
        {/* Clamped between two real steps of the scale (24 and 36) rather than
              28 and 44, which belonged to neither. */}
          <h1 className="display m-0 text-[clamp(1.5rem,3.5vw,2.25rem)]">
            {title}
          </h1>
      </div>
      {description && (
        <p className="m-0 max-w-[440px] text-xs text-fg-muted">
          {description}
        </p>
      )}
      {actions}
    </div>
  );
}
