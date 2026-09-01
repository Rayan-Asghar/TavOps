"use client";

import { useState } from "react";

/**
 * Shared by both copy widgets. Clipboard access throws outside a secure
 * context, so every caller has to survive the failure — the value stays
 * selectable on screen either way, which beats an alert.
 */
function useCopy(value: string) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Deliberately silent; see above.
    }
  }

  return { copied, copy };
}

/** Announced to screen readers without stealing focus. */
function CopyAnnouncement({ copied }: { copied: boolean }) {
  return (
    <span aria-live="polite" className="sr-only">
      {copied ? "Copied to clipboard" : ""}
    </span>
  );
}

/** Read-only value with a copy button and a short confirmation. */
export function CopyField({ value, label }: { value: string; label?: string }) {
  const { copied, copy } = useCopy(value);

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
      <CopyAnnouncement copied={copied} />
    </div>
  );
}

/**
 * The multi-line sibling. Same behaviour, but the value keeps its line breaks —
 * for text meant to be pasted somewhere else whole rather than read as a token.
 */
export function CopyBlock({
  value,
  label,
  buttonLabel = "Copy",
}: {
  value: string;
  label?: string;
  buttonLabel?: string;
}) {
  const { copied, copy } = useCopy(value);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        {label && <span className="label m-0">{label}</span>}
        <button type="button" onClick={copy} className="btn-secondary shrink-0 px-3">
          {copied ? "Copied" : buttonLabel}
        </button>
      </div>
      <pre
        className="select-all overflow-x-auto whitespace-pre-wrap rounded-lg border
                   border-border bg-bg px-3 py-2 font-mono text-xs leading-relaxed text-fg"
      >
        {value}
      </pre>
      <CopyAnnouncement copied={copied} />
    </div>
  );
}
