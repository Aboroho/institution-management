"use client";
import { AccountSettings } from "@/components/account/account-settings";
import { Breadcrumbs, PageHeader } from "@/components/ui";

export default function StudentProfilePage() {
  return (
    <div>
      <Breadcrumbs items={[{ label: "Student", href: "/student/dashboard" }, { label: "Profile" }]} />
      <PageHeader title="Profile & account" subtitle="Manage your own name, email and password. Your enrollment details are managed by the administration." />
      <AccountSettings />
    </div>
  );
}
