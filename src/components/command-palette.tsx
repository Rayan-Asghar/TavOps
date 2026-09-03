"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";

/**
 * Command palette.
 *
 * DESIGN-STANDARD 4.2 r13 is emphatic about what this is *not*: an escape hatch
 * for power users, never the fix for weak navigation, and never the only path to
 * anything. Every destination below is also a sidebar item or a link on a page —
 * the palette is a shortcut, not a hiding place.
 *
 * 2.1 gives it a second job. Linear's palette duplicates every action *and shows
 * its shortcut*, which is how the team learns the keyboard model without reading
 * documentation. So each row here carries the key that would have done the same
 * thing, and the shortcuts are real: they are handled by this component.
 *
 * r12: recents come first, because "continue where you left off" is the common
 * case on an interrupted two-person team.
 *
 * r14: bindings must not override standard shortcuts. `G`-then-letter and the
 * single letters are ignored whenever a text field has focus or a modifier is
 * held, so copy, paste, select-all, print and find all behave normally.
 */

export type PaletteDestination = {
  href: string;
  label: string;
  /** The `G`-then-letter jump, e.g. "I" for `G I`. */
  jump?: string;
};

export type PaletteRecent = {
  id: string;
  code: string;
  name: string;
  health: string;
};

const HEALTH_LABEL: Record<string, string> = {
  on_track: "On track",
  at_risk: "At risk",
  blocked: "Blocked",
};

export function CommandPalette({
  destinations,
  actions,
  recents,
}: {
  destinations: PaletteDestination[];
  actions: PaletteDestination[];
  recents: PaletteRecent[];
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  /** r13: focus returns to whatever had it when the palette opened. */
  const opener = useRef<HTMLElement | null>(null);
  /** Tracks a pending `G`, so `G` then `I` jumps to the inbox. */
  const pendingJump = useRef<number | null>(null);

  /* The server cannot know the platform, and a `setState` in an effect to correct
     it after mount is a cascading render. `useSyncExternalStore` is the idiomatic
     way to read a client-only value: the server snapshot renders "Ctrl", the
     client snapshot renders the right one, and React reconciles without an extra
     pass. The subscribe callback is a no-op because the platform never changes. */
  const isMac = useSyncExternalStore(
    () => () => {},
    () => /Mac|iPhone|iPad|iPod/.test(navigator.userAgent),
    () => false,
  );
  const modKey = isMac ? "\u2318" : "Ctrl ";

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  const jumps = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of [...destinations, ...actions]) {
      if (d.jump) m.set(d.jump.toLowerCase(), d.href);
    }
    return m;
  }, [destinations, actions]);

  useEffect(() => {
    /** True when the keystroke belongs to whatever the user is typing into. */
    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el.isContentEditable ||
        // The work-log grid is a keyboard surface of its own; its cells own
        // every bare keystroke, including the letters used for jumps.
        !!el.closest("[data-grid-surface]")
      );
    };

    const onKey = (e: KeyboardEvent) => {
      // Open: the one binding that works even while typing, because that is the
      // universal convention and users expect it from anywhere.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        opener.current = document.activeElement as HTMLElement | null;
        setOpen((v) => !v);
        return;
      }

      // r14: never shadow a browser or OS shortcut, and never steal a keystroke
      // from a field. Everything below is a bare letter with no modifier.
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (open) return;

      const k = e.key.toLowerCase();

      if (pendingJump.current !== null) {
        window.clearTimeout(pendingJump.current);
        pendingJump.current = null;
        const href = jumps.get(k);
        if (href) {
          e.preventDefault();
          router.push(href);
        }
        return;
      }

      if (k === "g") {
        // Arm the chord, and disarm it if the second key never comes.
        pendingJump.current = window.setTimeout(() => {
          pendingJump.current = null;
        }, 1400);
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (pendingJump.current !== null) window.clearTimeout(pendingJump.current);
    };
  }, [open, jumps, router]);

  // Return focus where it was, so the palette does not strand a keyboard user.
  useEffect(() => {
    if (!open && opener.current) {
      opener.current.focus?.();
      opener.current = null;
    }
  }, [open]);

  return (
    <>
      {/* r14: accelerators have to be discoverable. This is also the only way a
          mouse user reaches the palette at all — a keyboard-only entry point
          would make it invisible to half the ways people work. */}
      <button
        type="button"
        onClick={() => {
          opener.current = document.activeElement as HTMLElement | null;
          setOpen(true);
        }}
        aria-label="Open command palette"
        className="hidden min-h-[34px] items-center gap-2 rounded-lg border border-border
                   bg-surface px-2.5 text-2xs font-bold text-fg-muted
                   transition-[color,background-color,border-color] duration-150 ease-out-quad
                   hover:border-border-strong hover:text-fg sm:inline-flex"
      >
        <span>Search</span>
        <kbd className="rounded border border-border bg-surface-2 px-1 py-px font-sans text-2xs
                        font-bold text-fg-subtle">
          {modKey}K
        </kbd>
      </button>

    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command palette"
      description="Jump to a section, reopen recent work, or start something new."
      /* 5.8 specifies this moment exactly: 150ms ease-out, scale up with opacity,
         origin centre-top. The stock dialog runs 200ms from the centre, which is
         the modal timing — a palette is lighter and should arrive faster. 5.5 also
         warns about popovers scaling from the wrong place. Width is 640 rather than
         the dialog default of 512: this list carries a code, a name and a shortcut
         on one line — and the override needs the `sm:` prefix, because the dialog
         sets `sm:max-w-lg` and a base-level utility loses to a responsive one. */
      className="top-[14%] sm:max-w-[640px] translate-y-0 duration-150 ease-out-quad
                 data-[state=closed]:duration-100 data-[state=open]:origin-top"
    >
      <CommandInput placeholder="Search sections, projects and actions…" />
      {/* Tall enough not to clip a row mid-height, capped so it never runs off a
          laptop screen. */}
      <CommandList className="max-h-[min(60vh,420px)]">
        <CommandEmpty>
          Nothing matches. Every section is also in the sidebar.
        </CommandEmpty>

        {recents.length > 0 && (
          <>
            <CommandGroup heading="Recent">
              {recents.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`${p.code} ${p.name}`}
                  onSelect={() => go(`/projects/${p.id}`)}
                >
                  <span className="font-mono text-2xs text-muted-foreground">
                    {p.code}
                  </span>
                  <span className="truncate">{p.name}</span>
                  <CommandShortcut>
                    {HEALTH_LABEL[p.health] ?? p.health}
                  </CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading="Go to">
          {destinations.map((d) => (
            <CommandItem key={d.href} value={d.label} onSelect={() => go(d.href)}>
              <span>{d.label}</span>
              {d.jump && <CommandShortcut>G {d.jump}</CommandShortcut>}
            </CommandItem>
          ))}
        </CommandGroup>

        {actions.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Actions">
              {actions.map((a) => (
                <CommandItem
                  key={a.href}
                  value={a.label}
                  onSelect={() => go(a.href)}
                >
                  <span>{a.label}</span>
                  {a.jump && <CommandShortcut>G {a.jump}</CommandShortcut>}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
    </>
  );
}
