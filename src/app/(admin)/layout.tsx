import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/session";
import { AppShell } from "@/components/shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuth();
  if (!auth) redirect("/login?next=/admin/dashboard");
  if (auth.role !== "ADMIN") redirect("/login");
  return <AppShell role="ADMIN">{children}</AppShell>;
}
