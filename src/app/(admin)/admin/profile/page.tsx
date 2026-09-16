"use client";
import { AccountSettings } from "@/components/account/account-settings";
import { Breadcrumbs, PageHeader } from "@/components/ui";

export default function AdminProfilePage() {
  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Profile" }]} />
      <PageHeader title="Profile & account" subtitle="Manage your own name, email and password. Role and system permissions are fixed by the platform." />
      <AccountSettings />
    </div>
  );
}
