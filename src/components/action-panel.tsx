"use client";

import { useState, type ReactNode } from "react";

/**
 * One action panel instead of three stacked forms.
 *
 * Logging work and reporting a blocker are both "tell the system what just
 * happened", and a developer does exactly one of them at a time. Showing both
 * open at once tripled the height of the rail for no gain.
 */
export function ActionPanel({
  logWork,
  reportBlocker,
}: {
  logWork: ReactNode;
  reportBlocker: ReactNode;
}) {
  const options = [
    logWork ? { key: "log", label: "Log work", node: logWork } : null,
    reportBlocker
      ? { key: "blocker", label: "Report blocker", node: reportBlocker }
      : null,
  ].filter(Boolean) as { key: string; label: string; node: ReactNode }[];

  const [active, setActive] = useState(options[0]?.key ?? "log");

  if (options.length === 0) return null;

  return (
    <div>
      {options.length > 1 && (
        <div
          role="tablist"
          aria-label="Quick actions"
          className="mb-2 grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface-2 p-1"
        >
          {options.map((o) => (
            <button
              key={o.key}
              role="tab"
              type="button"
              aria-selected={active === o.key}
              onClick={() => setActive(o.key)}
              className={`rounded-lg px-3 py-2 text-[11px] font-bold transition-colors ${
                active === o.key
                  ? "bg-surface text-fg shadow-sm"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      {options.find((o) => o.key === active)?.node}
    </div>
  );
}

/**
 * Collapsed by default. Creating a task is an occasional act, so it should not
 * occupy the page for everyone who is only reading it.
 */
export function Disclosure({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn-secondary py-2 text-[12px]"
        >
          {label}
        </button>
      ) : (
        <div>
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[11px] font-bold text-fg-muted hover:text-fg"
            >
              Close
            </button>
          </div>
          {children}
        </div>
      )}
    </div>
  );
}
