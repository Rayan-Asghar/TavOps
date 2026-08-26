"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  InboxIcon,
  ProjectsIcon,
  PeopleIcon,
  SalesIcon,
  ReviewIcon,
  MenuIcon,
  CloseIcon,
} from "./icons";

export type NavEntry = {
  href: string;
  label: string;
  icon: "inbox" | "projects" | "people" | "sales" | "review";
  count?: number;
  danger?: boolean;
};

const ICONS = {
  inbox: InboxIcon,
  projects: ProjectsIcon,
  people: PeopleIcon,
  sales: SalesIcon,
  review: ReviewIcon,
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
                  text-[13px] font-medium transition-colors
                  ${active ? "bg-[#1a1a1a] text-white" : "text-[#9a9a9a] hover:bg-[#151515] hover:text-white"}`}
    >
      <Icon />
      <span>{entry.label}</span>
      {typeof entry.count === "number" && entry.count > 0 && (
        <span
          className={`grid h-5 min-w-[22px] place-items-center rounded-full px-1.5 text-[10px] font-extrabold
                      ${entry.danger ? "bg-brand text-white" : "bg-[#232323] text-[#aaa]"}`}
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
}: {
  main: NavEntry[];
  management: NavEntry[];
  userName: string;
  userRole: string;
  signOut: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

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
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
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
        className={`fixed inset-y-0 left-0 z-50 flex w-[248px] flex-col overflow-y-auto
                    bg-black px-3.5 py-4 text-white transition-transform duration-200
                    ${open ? "translate-x-0" : "-translate-x-[105%]"}
                    md:sticky md:inset-auto md:top-0 md:h-screen md:translate-x-0`}
      >
        <div className="flex min-h-[54px] items-center justify-between px-1.5">
          <Link href="/" onClick={close} className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center bg-brand text-[18px] font-black">
              T
            </span>
            <span className="flex flex-col gap-[5px] leading-none">
              <strong className="text-[14px] tracking-[.08em]">TAVREN</strong>
              <small className="text-[9px] tracking-[.14em] text-[#777]">
                INTERNAL OS
              </small>
            </span>
          </Link>
          <button
            type="button"
            onClick={close}
            aria-label="Close menu"
            className="grid h-8 w-8 place-items-center text-[#777] md:hidden"
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
          <div className="mt-7 border-t border-[#202020] pt-5">
            <p className="mx-2.5 mb-2 text-[9px] font-extrabold tracking-[.14em] text-[#555]">
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

        <div className="mt-auto border-t border-[#202020] pt-4">
          <div className="grid grid-cols-[34px_1fr] items-center gap-2.5 p-1.5">
            <span className="grid h-[34px] w-[34px] place-items-center rounded-full bg-brand text-[10px] font-extrabold">
              {initials}
            </span>
            <span className="flex min-w-0 flex-col">
              <strong className="truncate text-[11px]">{userName}</strong>
              <span className="text-[10px] capitalize text-[#666]">
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
