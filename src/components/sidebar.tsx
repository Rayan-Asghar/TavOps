"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  InboxIcon,
  ProjectsIcon,
  PeopleIcon,
  SalesIcon,
  ReviewIcon,
  LogIcon,
  MenuIcon,
  CloseIcon,
} from "./icons";

export type NavEntry = {
  href: string;
  label: string;
  icon: "inbox" | "projects" | "people" | "sales" | "review" | "log";
  count?: number;
  danger?: boolean;
};

const ICONS = {
  inbox: InboxIcon,
  projects: ProjectsIcon,
  people: PeopleIcon,
  sales: SalesIcon,
  review: ReviewIcon,
  log: LogIcon,
};

function NavLink({
  entry,
  active,
  onNavigate,
}: {
  entry: NavEntry;
  active: boolean;
  onNavigate: () => void;
}) {
  const Icon = ICONS[entry.icon];
  return (
    <Link
      href={entry.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`grid min-h-[44px] grid-cols-[24px_1fr_auto] items-center gap-2.5 rounded-lg px-2.5
                  text-sm font-medium transition-colors
                  ${active ? "bg-nav-active text-white" : "text-nav-fg-muted hover:bg-nav-hover hover:text-white"}`}
    >
      <Icon />
      <span>{entry.label}</span>
      {typeof entry.count === "number" && entry.count > 0 && (
        <span
          className={`grid h-5 min-w-[22px] place-items-center rounded-full px-1.5 text-xs font-extrabold
                      ${entry.danger ? "bg-brand text-white" : "bg-nav-chip text-nav-fg-muted"}`}
        >
          {entry.count}
        </span>
      )}
    </Link>
  );
}

export function Sidebar({
  main,
  management,
  userName,
  userRole,
  signOut,
  themeToggle,
}: {
  main: NavEntry[];
  management: NavEntry[];
  userName: string;
  userRole: string;
  signOut: React.ReactNode;
  themeToggle: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const wasOpen = useRef(false);

  // The same element is an off-canvas drawer below `md` and a static column
  // above it, so every drawer behaviour has to be conditional on width.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Escape to dismiss, and a focus trap so Tab cannot walk out of an open
  // drawer into the page behind it.
  useEffect(() => {
    if (!open || !isMobile) return;
    const el = asideRef.current;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key !== "Tab" || !el) return;
      const focusable = el.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    el?.querySelector<HTMLElement>("a[href], button")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, isMobile]);

  // Send focus back where it came from, rather than dropping it on <body>.
  useEffect(() => {
    if (wasOpen.current && !open && isMobile) triggerRef.current?.focus();
    wasOpen.current = open;
  }, [open, isMobile]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const initials = userName
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <>
      {/* Mobile trigger lives here so the shell stays a server component. */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className="fixed left-4 top-[18px] z-[60] grid h-[42px] w-[42px] place-items-center
                   rounded-lg border border-border bg-surface md:hidden"
      >
        <MenuIcon />
      </button>

      {open && (
        <div
          onClick={close}
          className="fixed inset-0 z-40 bg-black/35 md:hidden"
          aria-hidden
        />
      )}

      <aside
        ref={asideRef}
        aria-label="Main navigation"
        {...(isMobile && open ? { role: "dialog", "aria-modal": true } : {})}
        // Closed, it was only translated off-screen, so every nav link stayed
        // in the tab order behind the page.
        inert={isMobile && !open}
        className={`fixed inset-y-0 left-0 z-50 flex w-[248px] flex-col overflow-y-auto
                    bg-nav px-3.5 py-4 text-white transition-transform duration-200
                    ${open ? "translate-x-0" : "-translate-x-[105%]"}
                    md:sticky md:inset-auto md:top-0 md:h-screen md:translate-x-0`}
      >
        <div className="flex min-h-[54px] items-center justify-between px-1.5">
          <Link href="/" onClick={close} className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center bg-brand text-xl font-black">
              T
            </span>
            <span className="flex flex-col gap-[5px] leading-none">
              <strong className="text-base tracking-[.08em]">TAVREN</strong>
              <small className="text-2xs tracking-[.14em] text-nav-fg-subtle">
                INTERNAL OS
              </small>
            </span>
          </Link>
          <button
            type="button"
            onClick={close}
            aria-label="Close menu"
            className="grid h-8 w-8 place-items-center text-nav-fg-subtle md:hidden"
          >
            <CloseIcon />
          </button>
        </div>

        <nav aria-label="Main" className="mt-6 grid gap-1">
          {main.map((e) => (
            <NavLink
              key={e.href}
              entry={e}
              active={isActive(e.href)}
              onNavigate={close}
            />
          ))}
        </nav>

        {management.length > 0 && (
          <div className="mt-7 border-t border-nav-border pt-5">
            <p className="mx-2.5 mb-2 text-2xs font-extrabold tracking-[.14em] text-neutral">
              MANAGEMENT
            </p>
            <div className="grid gap-1">
              {management.map((e) => (
                <NavLink
                  key={e.href}
                  entry={e}
                  active={isActive(e.href)}
                  onNavigate={close}
                />
              ))}
            </div>
          </div>
        )}

        <div className="mt-auto border-t border-nav-border pt-4">
          <div className="mb-3 px-1.5">{themeToggle}</div>
          <div className="grid grid-cols-[34px_1fr] items-center gap-2.5 p-1.5">
            <span className="grid h-[34px] w-[34px] place-items-center rounded-full bg-brand text-xs font-extrabold">
              {initials}
            </span>
            <span className="flex min-w-0 flex-col">
              <strong className="truncate text-xs">{userName}</strong>
              <span className="text-xs capitalize text-nav-fg-subtle">
                {userRole.replace(/_/g, " ")}
              </span>
            </span>
          </div>
          <div className="mt-1 px-1.5">{signOut}</div>
        </div>
      </aside>
    </>
  );
}
