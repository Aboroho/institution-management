"use client";
// Real-API option loaders for dependent selects/filters.
import useSWR from "swr";
import { get } from "@/lib/api/client";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export type OptionItem = { value: string; label: string; search: string };

export function useAcademicYears() {
  const { data } = useSWR("opt-years", () => get<Row[]>("/academic-years?limit=100").then((r) => r.data));
  return (data ?? []).map((r) => {
    const label = str(r.name);
    return { value: str(r.id), label, search: label.toLowerCase() };
  });
}
export function useTrades() {
  const { data } = useSWR("opt-trades", () => get<Row[]>("/trades?limit=100").then((r) => r.data));
  return (data ?? []).map((r) => {
    const label = `${str(r.name)} (${str(r.code)})`;
    return { value: str(r.id), label, search: `${str(r.name)} ${str(r.code)}`.toLowerCase() };
  });
}
export function useSemesters(tradeId?: string) {
  const { data } = useSWR(tradeId ? `opt-sem-${tradeId}` : "opt-sem-all", () =>
    get<Row[]>(`/semesters${tradeId ? `?tradeId=${tradeId}` : ""}`).then((r) => r.data));
  return (data ?? []).map((r) => {
    const label = str(r.name);
    return { value: str(r.id), label, search: label.toLowerCase() };
  });
}
export function useShifts() {
  const { data } = useSWR("opt-shifts", () => get<Row[]>("/shifts").then((r) => r.data));
  return (data ?? []).map((r) => {
    const label = str(r.name);
    return { value: str(r.id), label, search: label.toLowerCase() };
  });
}
export function useSections(f?: { academicYearId?: string; tradeId?: string; semesterId?: string; shiftId?: string }) {
  const q = new URLSearchParams({ limit: "100", ...(f?.academicYearId ? { academicYearId: f.academicYearId } : {}), ...(f?.tradeId ? { tradeId: f.tradeId } : {}), ...(f?.semesterId ? { semesterId: f.semesterId } : {}), ...(f?.shiftId ? { shiftId: f.shiftId } : {}) }).toString();
  const { data } = useSWR(`opt-sec-${q}`, () => get<Row[]>(`/sections?${q}`).then((r) => r.data));
  return (data ?? []).map((r) => {
    const label = str(r.name);
    return { value: str(r.id), label, search: label.toLowerCase() };
  });
}
export function useCourses() {
  const { data } = useSWR("opt-courses", () => get<Row[]>("/courses?limit=200").then((r) => r.data));
  return (data ?? []).map((r) => {
    const label = `${str(r.code)} — ${str(r.title)}`;
    return { value: str(r.id), label, search: `${str(r.code)} ${str(r.title)}`.toLowerCase() };
  });
}
export function useTeachers() {
  const { data } = useSWR("opt-teachers", () => get<Row[]>("/teachers?limit=200").then((r) => r.data));
  return (data ?? []).map((r) => {
    const name = str((r.user as Row)?.name);
    const label = `${name} (${str(r.employeeId)})`;
    return { value: str(r.id), label, search: `${name} ${str(r.employeeId)}`.toLowerCase() };
  });
}
export function useOfferings(params = "") {
  const { data } = useSWR(`opt-off-${params}`, () => get<Row[]>(`/course-offerings?limit=100${params}`).then((r) => r.data));
  return (data ?? []).map((r) => {
    const label = `${str((r.course as Row)?.title)} · ${str((r.section as Row)?.name)}`;
    return {
      value: str(r.id),
      label,
      search: `${str((r.course as Row)?.title)} ${str((r.course as Row)?.code)} ${str((r.section as Row)?.name)}`.toLowerCase(),
      row: r,
    };
  });
}

/** Remote student search (studentId, name or email) for searchable selects. */
export async function searchStudentOptions(query: string): Promise<OptionItem[]> {
  const r = await get<Row[]>(`/students?limit=20&search=${encodeURIComponent(query)}`);
  return (r.data ?? []).map((s) => {
    const name = str((s.user as Row)?.name);
    const label = `${str(s.studentId)} — ${name}`;
    return { value: str(s.id), label, search: `${str(s.studentId)} ${name} ${str((s.user as Row)?.email)}`.toLowerCase() };
  });
}
