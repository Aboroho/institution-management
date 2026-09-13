import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EMS — Educational Management System",
  description: "Manage academics, students, teachers, attendance, assessments, marks and more.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
