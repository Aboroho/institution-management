"use client";
import Link from "next/link";
import { PageHeader, Card, Breadcrumbs } from "@/components/ui";
import { ClipboardCheck, Award, User } from "lucide-react";

export default function ReportsPage() {
  const cards = [
    { href: "/admin/reports/attendance", title: "Attendance report", desc: "Server-side aggregated attendance by student.", icon: <ClipboardCheck size={22} /> },
    { href: "/admin/reports/marks", title: "Marks report", desc: "Assessment results, pass/fail and percentages.", icon: <Award size={22} /> },
    { href: "/admin/students", title: "Student reports", desc: "Open a student, then view their full report.", icon: <User size={22} /> },
  ];
  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Reports" }]} />
      <PageHeader title="Reports" subtitle="Aggregated server-side — large datasets never load into the browser." />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {cards.map((c) => (
          <Link key={c.href} href={c.href}>
            <Card className="p-6 transition hover:shadow-md">
              <span className="inline-block rounded-lg bg-brand-50 p-2 text-brand-700">{c.icon}</span>
              <p className="mt-3 font-semibold">{c.title}</p>
              <p className="mt-1 text-sm text-slate-500">{c.desc}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
