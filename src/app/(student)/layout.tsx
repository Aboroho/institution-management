import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/session";
import { AppShell } from "@/components/shell";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuth();
  if (!auth) redirect("/login?next=/student/dashboard");
  if (auth.role !== "STUDENT") redirect("/login");
  return <AppShell role="STUDENT">{children}</AppShell>;
}
