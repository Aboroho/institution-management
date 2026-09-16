"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import useSWR from "swr";
import {
  LayoutDashboard, GraduationCap, Users, UserCheck, BookOpen, Library, Layers,
  CalendarDays, ClipboardCheck, FileText, Award, Megaphone, Bell, BarChart3,
  ScrollText, Settings, LogOut, Menu, X, ArrowLeftRight, UserPlus, Clock,
  UserCircle, UserCog,
} from "lucide-react";
import { authApi, get } from "@/lib/api/client";
import { cn } from "@/components/ui";

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
  { href: "/admin/audit-logs", label: "Audit Logs", icon: <ScrollText size={18} />, group: "Administration" },
  { href: "/admin/users", label: "Admins", icon: <UserCog size={18} />, group: "Administration" },
  { href: "/admin/settings", label: "Settings", icon: <Settings size={18} />, group: "Administration" },
  { href: "/admin/profile", label: "Profile", icon: <UserCircle size={18} />, group: "Administration" },
];

const TEACHER_NAV: NavItem[] = [
  { href: "/teacher/dashboard", label: "Dashboard", icon: <LayoutDashboard size={18} /> },
  { href: "/teacher/course-offerings", label: "My Courses", icon: <BookOpen size={18} /> },
  { href: "/teacher/schedule", label: "Schedule", icon: <CalendarDays size={18} /> },
  { href: "/teacher/notices", label: "Notices", icon: <Megaphone size={18} /> },
  { href: "/teacher/notifications", label: "Notifications", icon: <Bell size={18} /> },
  { href: "/teacher/profile", label: "Profile", icon: <UserCircle size={18} /> },
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
  { href: "/student/profile", label: "Profile", icon: <UserCircle size={18} /> },
];

export function AppShell({ role, children }: { role: "ADMIN" | "TEACHER" | "STUDENT"; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { data: me } = useSWR("me", () => authApi.me().then((r) => r.data));
  const { data: notifMeta } = useSWR("notif-count", () => get<unknown[]>("/notifications?limit=1").then((r) => r.meta), { refreshInterval: 60000 });

  const nav = role === "ADMIN" ? ADMIN_NAV : role === "TEACHER" ? TEACHER_NAV : STUDENT_NAV;
  const groups: { name: string | null; items: NavItem[] }[] = [];
  for (const item of nav) {
    const g = item.group ?? null;
    let bucket = groups.find((x) => x.name === g);
    if (!bucket) { bucket = { name: g, items: [] }; groups.push(bucket); }
    bucket.items.push(item);
  }
  const unread = Number((notifMeta as Record<string, unknown> | undefined)?.unreadCount ?? 0);
  const notifHref = role === "ADMIN" ? "/admin/notifications" : role === "TEACHER" ? "/teacher/notifications" : "/student/notifications";

  async function logout() {
    await authApi.logout();
    router.push("/login");
    router.refresh();
  }

  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <span className="font-bold text-brand-700">EMS</span>
        <button onClick={() => setOpen(!open)} aria-label="Menu" className="rounded p-2 hover:bg-slate-100">
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      <div className="flex">
        <aside className={cn("fixed inset-y-0 left-0 z-30 w-64 transform border-r border-slate-200 bg-white transition-transform lg:static lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
          <div className="hidden items-center gap-2 border-b border-slate-100 px-5 py-4 lg:flex">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 font-bold text-white">E</span>
            <div>
              <p className="font-bold text-slate-900">EMS</p>
              <p className="text-xs text-slate-500">{role.charAt(0) + role.slice(1).toLowerCase()} Portal</p>
            </div>
          </div>
          <nav className="max-h-[calc(100vh-64px)] overflow-y-auto p-3">
            {groups.map((g, gi) => (
              <div key={gi} className="mb-2">
                {g.name && <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{g.name}</p>}
                {g.items.map((item) => {
                  const active = pathname === item.href || (item.href !== `/${role.toLowerCase()}/dashboard` && pathname.startsWith(item.href));
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn("mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
                        active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100")}
                    >
                      {item.icon}{item.label}
                      {item.href === notifHref && unread > 0 && (
                        <span className="ml-auto rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-bold text-white">{unread}</span>
                      )}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 hidden items-center justify-between border-b border-slate-200 bg-white px-6 py-3 lg:flex">
            <p className="text-sm text-slate-500">Educational Management System</p>
            <div className="flex items-center gap-3">
              <Link href={notifHref} className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Notifications">
                <Bell size={20} />
                {unread > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">{unread}</span>}
              </Link>
              <span className="text-sm font-medium text-slate-700">{me?.name}</span>
              <button onClick={logout} className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100">
                <LogOut size={16} /> Logout
              </button>
            </div>
          </header>
          {/* Mobile user row */}
          <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2 lg:hidden">
            <span className="text-sm font-medium text-slate-700">{me?.name}</span>
            <button onClick={logout} className="flex items-center gap-1 text-sm text-slate-500"><LogOut size={16} /> Logout</button>
          </div>
          <main className="mx-auto w-full max-w-7xl p-4 lg:p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
