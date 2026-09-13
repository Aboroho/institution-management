import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/session";
import { AppShell } from "@/components/shell";

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuth();
  if (!auth) redirect("/login?next=/teacher/dashboard");
  if (auth.role !== "TEACHER") redirect("/login");
  return <AppShell role="TEACHER">{children}</AppShell>;
}
