"use client";

import {
  useCallback,
  useEffect,
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
 * It had a `G`-then-letter chord too, so the rows could teach a keyboard model
 * the way 2.1 describes Linear's. That came out with the queue's `J`/`K`: bare
 * letters firing globally were not earning their cost here. ⌘K stays — it is one
 * binding, everyone already expects it, and it needs no teaching.
 *
 * r12: recents come first, because "continue where you left off" is the common
 * case on an interrupted two-person team.
 *
 * r13 is the rule that shapes the rest: a palette is an escape hatch, never the
 * fix for weak navigation, and never the only path to anything. Every row is
 * also a sidebar item or a link on a page.
 */

export type PaletteDestination = {
  href: string;
  label: string;
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

  useEffect(() => {
    /** True when the keystroke belongs to whatever the user is typing into. */
    const onKey = (e: KeyboardEvent) => {
      // Open: the one binding that works even while typing, because that is the
      // universal convention and users expect it from anywhere.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        opener.current = document.activeElement as HTMLElement | null;
        setOpen((v) => !v);
        return;
      }

    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

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
