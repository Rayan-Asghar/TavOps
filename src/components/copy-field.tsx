"use client";

import { useState } from "react";

/** Read-only value with a copy button and a short confirmation. */
export function CopyField({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is blocked outside a secure context; the value is selectable
      // on screen either way, so failing silently is better than an alert.
    }
  }

  return (
    <div>
      {label && <span className="label">{label}</span>}
      <div className="flex items-stretch gap-2">
        <code
          className="flex-1 select-all overflow-x-auto rounded-lg border border-border
                     bg-bg px-3 py-2 font-mono text-sm text-fg"
        >
          {value}
        </code>
        <button type="button" onClick={copy} className="btn-secondary shrink-0 px-3">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {/* Announced to screen readers without stealing focus. */}
      <span aria-live="polite" className="sr-only">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </div>
  );
}
