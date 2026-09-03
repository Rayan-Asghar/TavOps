"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, type Tone } from "./badges";
import { ArrowRightIcon } from "./icons";
import { SnoozeButton } from "./snooze-button";
import { DismissButton } from "./dismiss-button";
import { KIND_META, SIGNAL_COLOR, type Signal } from "@/lib/tone";
import { timeAgo } from "@/lib/format";
import {
  dismissNotification,
  snoozeNotificationAction,
} from "@/server/inbox-actions";

/**
 * The triage queue, with a cursor.
 *
 * DESIGN-STANDARD 2.1: "the mental model is *cursor = selection*, so triage
 * never requires opening a record", and it is explicit that clearing an item
 * must not require a detail view. So `J`/`K` move, `E` clears, `S` snoozes until
 * tomorrow, and `Enter` opens — all without the mouse and without leaving the
 * page.
 *
 * §5.2 governs how this feels: row selection and `J`/`K` movement are named as
 * things that get **zero animation**, because they happen hundreds of times a
 * day and any delay reads as lag. The cursor is therefore an instant paint —
 * no transition on the row, deliberately.
 *
 * §3.6: hover is not selection. The cursor is a persistent left bar plus a tinted
 * row and it survives the pointer leaving, which a hover state cannot.
 *
 * r14: every binding is a bare letter, ignored whenever a modifier is held or a
 * field has focus, so copy, paste and find keep working.
 */

export type QueueItem = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  projectId: string | null;
  createdAt: Date;
};

export function AttentionQueue({ items }: { items: QueueItem[] }) {
  const [cursor, setCursor] = useState(0);
  /** Set once the user has actually used the keyboard, so a mouse-only session
   *  never sees a cursor it did not ask for. */
  const [keyboardActive, setKeyboardActive] = useState(false);
  const rowsRef = useRef<(HTMLLIElement | null)[]>([]);
  const router = useRouter();

  const hrefFor = useCallback(
    (n: QueueItem) =>
      n.kind === "task_needs_review"
        ? "/review"
        : n.projectId
          ? `/projects/${n.projectId}`
          : null,
    [],
  );

  useEffect(() => {
    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el.isContentEditable
      );
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (!items.length) return;
      const k = e.key.toLowerCase();
      const n = items[Math.min(cursor, items.length - 1)];

      if (k === "j" || k === "k") {
        e.preventDefault();
        // The first keystroke lands ON the first row rather than moving off it.
        // Without this, J skips row one, which reads as a dropped keypress.
        if (!keyboardActive) {
          setKeyboardActive(true);
          setCursor(k === "j" ? 0 : items.length - 1);
          return;
        }
        setCursor((c) => {
          const next = k === "j" ? c + 1 : c - 1;
          return Math.max(0, Math.min(items.length - 1, next));
        });
        return;
      }

      if (!keyboardActive) return; // don't act on a row nobody has pointed at

      if (k === "e") {
        e.preventDefault();
        const fd = new FormData();
        fd.set("id", n.id);
        void dismissNotification({}, fd).then(() => router.refresh());
        return;
      }
      if (k === "s") {
        e.preventDefault();
        const fd = new FormData();
        fd.set("id", n.id);
        fd.set("until", "tomorrow");
        void snoozeNotificationAction({}, fd).then(() => router.refresh());
        return;
      }
      if (k === "enter" || e.key === "Enter") {
        const href = hrefFor(n);
        if (href) {
          e.preventDefault();
          router.push(href);
        }
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [items, cursor, keyboardActive, router, hrefFor]);

  // Keep the cursor on screen. `block: "nearest"` so it only scrolls when it has
  // to, and `scroll-padding-top` in globals.css keeps it clear of the sticky header.
  useEffect(() => {
    if (!keyboardActive) return;
    rowsRef.current[cursor]?.scrollIntoView({ block: "nearest" });
  }, [cursor, keyboardActive]);

  return (
    <>
      <ul>
        {items.map((n, i) => {
          const meta = KIND_META[n.kind] ?? {
            label: n.kind,
            tone: "neutral" as Tone,
            signal: "waiting" as Signal,
          };
          const active = keyboardActive && i === cursor;
          const href = hrefFor(n);
          return (
            <li
              key={n.id}
              ref={(el) => {
                rowsRef.current[i] = el;
              }}
              aria-current={active ? "true" : undefined}
              /* No transition here on purpose (§5.2). The bar is a real 3px
                 border rather than an outline so it cannot be confused with the
                 focus ring, which means something else. */
              className={`attention-row border-l-[3px] ${
                active ? "border-l-brand bg-brand-soft" : "border-l-transparent"
              }`}
            >
              <span
                className={`mt-1.5 signal ${SIGNAL_COLOR[meta.signal]}`}
                aria-hidden
              />
              <div className="min-w-0">
                <strong className="block text-xs">{n.title}</strong>
                {n.body && (
                  <span className="mt-0.5 block text-xs text-fg-muted">
                    {n.body}
                  </span>
                )}
                <span className="mt-1 block text-2xs text-fg-subtle">
                  {timeAgo(n.createdAt)}
                </span>
              </div>
              <div className="col-start-2 flex flex-wrap items-center gap-3 sm:col-start-auto sm:shrink-0 sm:justify-end">
                <Badge tone={meta.tone}>{meta.label}</Badge>
                {/* Review items open the queue rather than the project: the queue
                    is where the approve / send-back decision is made, and it
                    carries the revision round. */}
                {href && (
                  <Link
                    href={href}
                    className="btn-text"
                    aria-label={`${n.kind === "task_needs_review" ? "Open review queue" : "Open project"} for: ${n.title}`}
                  >
                    {n.kind === "task_needs_review" ? "Review" : "Open"}{" "}
                    <ArrowRightIcon />
                  </Link>
                )}
                <SnoozeButton id={n.id} title={n.title} />
                <DismissButton id={n.id} title={n.title} />
              </div>
            </li>
          );
        })}
      </ul>

      {/* 2.1: the palette is a discovery surface for shortcuts, and so is this.
          A keyboard model nobody can see is a keyboard model nobody uses. */}
      <p className="m-0 border-t border-border px-4 py-2.5 text-2xs text-fg-muted">
        <kbd className="font-sans font-bold text-fg">J</kbd>{" "}
        <kbd className="font-sans font-bold text-fg">K</kbd> move &middot;{" "}
        <kbd className="font-sans font-bold text-fg">E</kbd> dismiss &middot;{" "}
        <kbd className="font-sans font-bold text-fg">S</kbd> snooze until
        tomorrow &middot;{" "}
        <kbd className="font-sans font-bold text-fg">Enter</kbd> open
      </p>
    </>
  );
}
