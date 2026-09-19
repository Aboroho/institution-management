"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import useSWR from "swr";
import {
  LayoutDashboard, GraduationCap, Users, UserCheck, BookOpen, Library, Layers,
  CalendarDays, ClipboardCheck, FileText, Award, Megaphone, Bell, BarChart3,
  ScrollText, Settings, LogOut, Menu, X, ArrowLeftRight, UserPlus, Clock,
  ShieldCheck, UserCircle, PanelLeftClose, PanelLeftOpen,
} from "lucide-react";
import { authApi, get } from "@/lib/api/client";
import { Spinner, Tooltip, cn } from "@/components/ui";

interface NavItem { href: string; label: string; icon: React.ReactNode; group?: string }

const ADMIN_NAV: NavItem[] = [
  { href: "/admin/dashboard", label: "Dashboard", icon: <LayoutDashboard size={18} /> },
  { href: "/admin/academic-years", label: "Academic Years", icon: <CalendarDays size={18} />, group: "Academic" },
  { href: "/admin/trades", label: "Trades", icon: <GraduationCap size={18} />, group: "Academic" },
  { href: "/admin/semesters", label: "Semesters", icon: <Layers size={18} />, group: "Academic" },
  { href: "/admin/shifts", label: "Shifts", icon: <Clock size={18} />, group: "Academic" },
  { href: "/admin/sections", label: "Sections", icon: <Library size={18} />, group: "Academic" },
  { href: "/admin/courses", label: "Courses", icon: <BookOpen size={18} />, group: "Academic" },
  { href: "/admin/curricula", label: "Curricula", icon: <FileText size={18} />, group: "Academic" },
  { href: "/admin/course-offerings", label: "Course Offerings", icon: <Layers size={18} />, group: "Academic" },
  { href: "/admin/students", label: "Students", icon: <Users size={18} />, group: "People" },
  { href: "/admin/teachers", label: "Teachers", icon: <UserCheck size={18} />, group: "People" },
  { href: "/admin/teacher-assignment", label: "Teacher Assignment", icon: <UserPlus size={18} />, group: "People" },
  { href: "/admin/enrollments", label: "Enrollments", icon: <UserPlus size={18} />, group: "Operations" },
  { href: "/admin/promotions", label: "Promotions", icon: <ArrowLeftRight size={18} />, group: "Operations" },
  { href: "/admin/attendance", label: "Attendance", icon: <ClipboardCheck size={18} />, group: "Operations" },
  { href: "/admin/attendance/approvals", label: "Attendance approvals", icon: <ClipboardCheck size={18} />, group: "Operations" },
  { href: "/admin/assessments", label: "Assessments", icon: <FileText size={18} />, group: "Operations" },
  { href: "/admin/marks", label: "Marks", icon: <Award size={18} />, group: "Operations" },
  { href: "/admin/marks/approvals", label: "Mark approvals", icon: <Award size={18} />, group: "Operations" },
  { href: "/admin/schedules", label: "Schedules", icon: <CalendarDays size={18} />, group: "Operations" },
  { href: "/admin/notices", label: "Notices", icon: <Megaphone size={18} />, group: "Operations" },
  { href: "/admin/notifications", label: "Notifications", icon: <Bell size={18} />, group: "Communication" },
  { href: "/admin/reports", label: "Reports", icon: <BarChart3 size={18} />, group: "Insights" },
  { href: "/admin/admins", label: "Admin Accounts", icon: <ShieldCheck size={18} />, group: "Administration" },
  { href: "/admin/profile", label: "My Profile", icon: <UserCircle size={18} />, group: "Administration" },
  { href: "/admin/audit-logs", label: "Audit Logs", icon: <ScrollText size={18} />, group: "Administration" },
  { href: "/admin/settings", label: "Settings", icon: <Settings size={18} />, group: "Administration" },
];

const TEACHER_NAV: NavItem[] = [
  { href: "/teacher/dashboard", label: "Dashboard", icon: <LayoutDashboard size={18} /> },
  { href: "/teacher/course-offerings", label: "My Courses", icon: <BookOpen size={18} /> },
  { href: "/teacher/schedule", label: "Schedule", icon: <CalendarDays size={18} /> },
  { href: "/teacher/notices", label: "Notices", icon: <Megaphone size={18} /> },
  { href: "/teacher/notifications", label: "Notifications", icon: <Bell size={18} /> },
  { href: "/teacher/profile", label: "My Profile", icon: <UserCircle size={18} /> },
];

const STUDENT_NAV: NavItem[] = [
  { href: "/student/dashboard", label: "Dashboard", icon: <LayoutDashboard size={18} /> },
  { href: "/student/courses", label: "My Courses", icon: <BookOpen size={18} /> },
  { href: "/student/schedule", label: "Schedule", icon: <CalendarDays size={18} /> },
  { href: "/student/attendance", label: "Attendance", icon: <ClipboardCheck size={18} /> },
  { href: "/student/assessments", label: "Assessments", icon: <FileText size={18} /> },
  { href: "/student/marks", label: "Marks", icon: <Award size={18} /> },
  { href: "/student/notices", label: "Notices", icon: <Megaphone size={18} /> },
  { href: "/student/notifications", label: "Notifications", icon: <Bell size={18} /> },
  { href: "/student/profile", label: "My Profile", icon: <UserCircle size={18} /> },
];

const COLLAPSE_KEY = "ems.nav.collapsed";

/**
 * One navigation implementation for all three portals.
 *
 * Desktop: a persistent rail that the user can collapse to icons only. The
 * choice is remembered in localStorage (a UI preference — no schema change) and
 * read before paint so the layout does not flash from wide to narrow. Collapsed
 * items keep their meaning through tooltips and accessible names.
 *
 * Mobile: the rail becomes a drawer with a visible hamburger on the LEFT of the
 * header, a close button inside, a scrim that closes it on outside click,
 * Escape-to-close, focus trapping and a locked background scroll.
 */
export function AppShell({ role, children }: { role: "ADMIN" | "TEACHER" | "STUDENT"; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const { data: me } = useSWR("me", () => authApi.me().then((r) => r.data));
  const { data: notifMeta } = useSWR("notif-count", () => get<unknown[]>("/notifications?limit=1").then((r) => r.meta), { refreshInterval: 60000 });

  const nav = role === "ADMIN" ? ADMIN_NAV : role === "TEACHER" ? TEACHER_NAV : STUDENT_NAV;
  const groups = useMemo(() => {
    const result: { name: string | null; items: NavItem[] }[] = [];
    for (const item of nav) {
      const g = item.group ?? null;
      let bucket = result.find((x) => x.name === g);
      if (!bucket) { bucket = { name: g, items: [] }; result.push(bucket); }
      bucket.items.push(item);
    }
    return result;
  }, [nav]);

  const unread = Number((notifMeta as Record<string, unknown> | undefined)?.unreadCount ?? 0);
  const portal = role.toLowerCase();
  const notifHref = `/${portal}/notifications`;
  const profileHref = `/${portal}/profile`;
  const portalLabel = role.charAt(0) + role.slice(1).toLowerCase();

  // Restore the desktop preference. Runs once on mount, before the user can
  // notice, and never on mobile where the drawer is an overlay by design.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch { /* private mode: keep the default */ }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try { window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // Close the drawer after navigating.
  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  // Escape closes; background scroll is locked while the overlay covers the page.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setDrawerOpen(false); toggleRef.current?.focus(); return; }
      if (event.key !== "Tab") return;
      const focusables = drawerRef.current?.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])",
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    // Move focus into the drawer so keyboard and screen-reader users are not
    // left behind on the page underneath.
    const timer = setTimeout(() => drawerRef.current?.querySelector<HTMLElement>("button, a[href]")?.focus(), 0);
    return () => {
      clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [drawerOpen]);

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await authApi.logout();
      router.push("/login");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  function isActive(href: string) {
    return pathname === href || (href !== `/${portal}/dashboard` && pathname.startsWith(`${href}/`));
  }

  const navList = (
    <nav aria-label={`${portalLabel} navigation`} className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-6 pt-3 lg:pt-2">
      {groups.map((group, groupIndex) => (
        <div key={groupIndex} className={cn(groupIndex > 0 && "mt-1")}>
          {group.name && (
            collapsed ? (
              <div className="mx-3 my-2 border-t border-slate-200 lg:block" aria-hidden="true" />
            ) : (
              <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{group.name}</p>
            )
          )}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(item.href);
              const badge = item.href === notifHref && unread > 0 ? unread : 0;
              const link = (
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  aria-label={collapsed ? item.label : undefined}
                  title={undefined}
                  className={cn(
                    // 44px tall on touch, tighter on desktop: comfortable targets
                    // without turning the admin rail into a scroll marathon.
                    "flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-sm font-medium transition lg:min-h-0 lg:py-2",
                    collapsed ? "lg:justify-center lg:px-2" : "",
                    active ? "bg-brand-50 font-semibold text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                  )}
                >
                  <span className={cn("relative shrink-0", active && "text-brand-700")} aria-hidden="true">
                    {item.icon}
                    {collapsed && badge > 0 && (
                      <span className="absolute -right-1.5 -top-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />
                    )}
                  </span>
                  <span className={cn("min-w-0 flex-1 truncate", collapsed && "lg:hidden")}>{item.label}</span>
                  {badge > 0 && (
                    <span className={cn("ml-auto rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-bold text-white", collapsed && "lg:hidden")}>
                      {badge}
                      <span className="sr-only"> unread</span>
                    </span>
                  )}
                </Link>
              );
              return (
                <li key={item.href}>
                  {collapsed ? (
                    // Icons alone are not self-explanatory — every collapsed item
                    // keeps a name for mouse, keyboard and screen readers.
                    <Tooltip content={badge > 0 ? `${item.label} · ${badge} unread` : item.label} side="right" className="w-full">
                      {link}
                    </Tooltip>
                  ) : link}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const brand = (
    <div className={cn("flex items-center gap-2 border-b border-slate-100 px-4 py-4", collapsed && "lg:justify-center lg:px-2")}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 font-bold text-white" aria-hidden="true">E</span>
      <div className={cn("min-w-0", collapsed && "lg:hidden")}>
        <p className="font-bold leading-tight text-slate-900">EMS</p>
        <p className="truncate text-xs text-slate-500">{portalLabel} Portal</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Mobile header — hamburger on the left, as expected. */}
      <header className="sticky top-0 z-40 flex items-center gap-2 border-b border-slate-200 bg-white px-2 py-2 lg:hidden">
        <button
          ref={toggleRef}
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation menu"
          aria-expanded={drawerOpen}
          aria-controls="app-navigation-drawer"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <Menu size={22} aria-hidden="true" />
        </button>
        <span className="font-bold text-brand-700">EMS</span>
        <div className="ml-auto flex items-center gap-1">
          <Link
            href={notifHref}
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
            className="relative flex h-11 w-11 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <Bell size={20} aria-hidden="true" />
            {unread > 0 && <span className="absolute right-1.5 top-1.5 min-w-[17px] rounded-full bg-red-500 px-1 text-[10px] font-bold leading-[17px] text-white">{unread > 99 ? "99+" : unread}</span>}
          </Link>
          <Link
            href={profileHref}
            aria-label="My profile"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <UserCircle size={21} aria-hidden="true" />
          </Link>
        </div>
      </header>

      <div className="flex">
        {/* Scrim: a click anywhere outside the drawer closes it. */}
        {drawerOpen && (
          <div
            className="fixed inset-0 z-40 bg-slate-900/50 lg:hidden"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
        )}

        <aside
          id="app-navigation-drawer"
          ref={drawerRef}
          aria-label={`${portalLabel} navigation`}
          {...(drawerOpen ? { role: "dialog" as const, "aria-modal": true } : {})}
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex w-[17rem] flex-col border-r border-slate-200 bg-white ease-out",
            "transition-[transform,width,visibility] duration-200",
            "lg:sticky lg:top-0 lg:z-30 lg:h-screen lg:translate-x-0 lg:visible",
            collapsed ? "lg:w-[4.5rem]" : "lg:w-64",
            // `invisible` (not `hidden`) takes the off-screen drawer out of the
            // tab order and the accessibility tree without killing the slide
            // transition, and `lg:visible` keeps the desktop rail reachable.
            drawerOpen ? "visible translate-x-0 shadow-2xl" : "invisible -translate-x-full",
          )}
        >
          {/* Mobile drawer head: brand + an unmistakable close button, with real
              breathing room before the first navigation item. */}
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 lg:hidden">
            <span className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white" aria-hidden="true">E</span>
              <span className="font-bold text-slate-900">{portalLabel} Portal</span>
            </span>
            <button
              type="button"
              onClick={() => { setDrawerOpen(false); toggleRef.current?.focus(); }}
              aria-label="Close navigation menu"
              className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>

          <div className="hidden lg:block">{brand}</div>

          {navList}

          {/* Desktop collapse control — always visible, states clearly labelled. */}
          <div className="hidden border-t border-slate-100 p-2 lg:block">
            <Tooltip content={collapsed ? "Expand the menu to show labels" : "Collapse the menu to icons only"} side="right" className="w-full">
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-label={collapsed ? "Expand navigation menu" : "Collapse navigation menu"}
                aria-pressed={collapsed}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
                  collapsed && "justify-center px-2",
                )}
              >
                {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
                {!collapsed && <span>Collapse menu</span>}
              </button>
            </Tooltip>
          </div>

          {/* Mobile-only account row, inside the drawer where it belongs. */}
          <div className="border-t border-slate-100 p-3 lg:hidden">
            <Link href={profileHref} className="flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-100">
              <UserCircle size={18} aria-hidden="true" /> <span className="truncate">{me?.name ?? "My profile"}</span>
            </Link>
            <button
              type="button"
              onClick={() => void logout()}
              disabled={loggingOut}
              className="mt-0.5 flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
            >
              {loggingOut ? <Spinner label="Signing out" /> : <LogOut size={18} aria-hidden="true" />}
              {loggingOut ? "Signing out…" : "Logout"}
            </button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 hidden items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-2.5 lg:flex">
            <p className="text-sm text-slate-500">Educational Management System</p>
            <div className="flex items-center gap-1">
              <Tooltip content={unread > 0 ? `${unread} unread notification${unread === 1 ? "" : "s"}` : "No unread notifications"}>
                <Link
                  href={notifHref}
                  aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
                  className="relative flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <Bell size={19} aria-hidden="true" />
                  {unread > 0 && <span className="absolute right-1 top-1 min-w-[16px] rounded-full bg-red-500 px-1 text-[10px] font-bold leading-4 text-white">{unread > 99 ? "99+" : unread}</span>}
                </Link>
              </Tooltip>
              <Link
                href={profileHref}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <UserCircle size={18} aria-hidden="true" className="text-slate-400" />
                <span className="max-w-[12rem] truncate">{me?.name ?? "My profile"}</span>
              </Link>
              <button
                type="button"
                onClick={() => void logout()}
                disabled={loggingOut}
                aria-busy={loggingOut || undefined}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-60"
              >
                {loggingOut ? <Spinner label="Signing out" /> : <LogOut size={16} aria-hidden="true" />}
                {loggingOut ? "Signing out…" : "Logout"}
              </button>
            </div>
          </header>
          <main className="mx-auto w-full max-w-7xl p-4 lg:p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
