"use client";
// Real-API option loaders for dependent selects/filters.
import useSWR from "swr";
import { get } from "@/lib/api/client";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export function useAcademicYears() {
  const { data } = useSWR("opt-years", () => get<Row[]>("/academic-years?limit=100").then((r) => r.data));
  return (data ?? []).map((r) => ({ value: str(r.id), label: str(r.name) }));
}
export function useTrades() {
  const { data } = useSWR("opt-trades", () => get<Row[]>("/trades?limit=100").then((r) => r.data));
  return (data ?? []).map((r) => ({ value: str(r.id), label: `${str(r.name)} (${str(r.code)})` }));
}
export function useSemesters(tradeId?: string) {
  const { data } = useSWR(tradeId ? `opt-sem-${tradeId}` : "opt-sem-all", () =>
    get<Row[]>(`/semesters${tradeId ? `?tradeId=${tradeId}` : ""}`).then((r) => r.data));
  return (data ?? []).map((r) => ({ value: str(r.id), label: str(r.name) }));
}
export function useShifts() {
  const { data } = useSWR("opt-shifts", () => get<Row[]>("/shifts").then((r) => r.data));
  return (data ?? []).map((r) => ({ value: str(r.id), label: str(r.name) }));
}
export function useSections(f?: { academicYearId?: string; tradeId?: string; semesterId?: string; shiftId?: string }) {
  const q = new URLSearchParams({ limit: "100", ...(f?.academicYearId ? { academicYearId: f.academicYearId } : {}), ...(f?.tradeId ? { tradeId: f.tradeId } : {}), ...(f?.semesterId ? { semesterId: f.semesterId } : {}), ...(f?.shiftId ? { shiftId: f.shiftId } : {}) }).toString();
  const { data } = useSWR(`opt-sec-${q}`, () => get<Row[]>(`/sections?${q}`).then((r) => r.data));
  return (data ?? []).map((r) => ({ value: str(r.id), label: str(r.name) }));
}
export function useCourses() {
  const { data } = useSWR("opt-courses", () => get<Row[]>("/courses?limit=200").then((r) => r.data));
  return (data ?? []).map((r) => ({ value: str(r.id), label: `${str(r.code)} — ${str(r.title)}` }));
}
export function useTeachers() {
  const { data } = useSWR("opt-teachers", () => get<Row[]>("/teachers?limit=200").then((r) => r.data));
  return (data ?? []).map((r) => ({
    value: str(r.id),
    label: `${str((r.user as Row)?.name)} (${str(r.employeeId)})`,
  }));
}
export function useOfferings(params = "") {
  const { data } = useSWR(`opt-off-${params}`, () => get<Row[]>(`/course-offerings?limit=100${params}`).then((r) => r.data));
  return (data ?? []).map((r) => ({
    value: str(r.id),
    label: `${str((r.course as Row)?.title)} · ${str((r.section as Row)?.name)}`,
    row: r,
  }));
}
