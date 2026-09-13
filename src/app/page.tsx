import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/session";

export default async function Home() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (auth.role === "ADMIN") redirect("/admin/dashboard");
  if (auth.role === "TEACHER") redirect("/teacher/dashboard");
  redirect("/student/dashboard");
}
