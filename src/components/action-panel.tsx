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
        // Not a tablist. It declared role="tablist"/role="tab"/aria-selected
        // with no aria-controls, no tabpanel, no roving tabindex and no arrow
        // keys, so a screen reader announced "tab 1 of 2" and then could not
        // find the panel. Two buttons that swap a form are two buttons: native
        // focus order works, and aria-pressed says which one is on.
        <div
          role="group"
          aria-label="Quick actions"
          className="mb-2 grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface-2 p-1"
        >
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              aria-pressed={active === o.key}
              aria-controls="quick-action-form"
              onClick={() => setActive(o.key)}
              className={`rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
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
      <div id="quick-action-form">
        {options.find((o) => o.key === active)?.node}
      </div>
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
          className="btn-secondary btn-sm"
        >
          {label}
        </button>
      ) : (
        <div>
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="btn-ghost btn-sm"
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
