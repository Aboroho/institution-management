"use client";
import { AccountSettings } from "@/components/account/account-settings";
import { Breadcrumbs, PageHeader } from "@/components/ui";

export default function TeacherProfilePage() {
  return (
    <div>
      <Breadcrumbs items={[{ label: "Teacher", href: "/teacher/dashboard" }, { label: "Profile" }]} />
      <PageHeader title="Profile & account" subtitle="Manage your own name, email and password. Your teacher role is assigned by the administration." />
      <AccountSettings />
    </div>
  );
}
