"use client";

/**
 * Shared data access for attendance-entry change requests.
 *
 * The "Pending Update Requests" badge on Take Attendance and the dialog that
 * lists the requests both read through this hook, so the count and the detail
 * list always come from the same backend state (SWR dedupes identical keys).
 * A second, hand-rolled fetch inside the dialog is how a badge and a list end
 * up disagreeing right after a cancel.
 */

import useSWR, { useSWRConfig } from "swr";
import { get, post } from "@/lib/api/client";
import type { AttendanceChangeRequestRow } from "@/modules/attendance/attendance.types";

export type ChangeRequestScope = {
  courseOfferingId?: string;
  sessionId?: string;
  /** "PENDING" for the actionable list; undefined for the full history. */
  status?: "PENDING" | "APPROVED" | "REJECTED";
};

/**
 * Requests the caller is allowed to see. The backend scopes the query to the
 * authenticated teacher (`requestedById` is injected from the session), so this
 * hook never sends a teacher id of its own.
 *
 * `pendingCount` is `meta.pendingCount` — the database's count of still-pending
 * requests for this scope, not a tally of the rows on the current page.
 */
export function useAttendanceChangeRequests(scope: ChangeRequestScope | null) {
  const params = scope
    ? { status: scope.status, courseOfferingId: scope.courseOfferingId, sessionId: scope.sessionId, limit: 50 }
    : null;
  const query = params
    ? `?${new URLSearchParams(
        Object.entries(params)
          .filter(([, value]) => value !== undefined && value !== "")
          .map(([key, value]) => [key, String(value)]),
      ).toString()}`
    : "";
  const key = scope ? `att-change-requests-${scope.courseOfferingId ?? ""}-${scope.sessionId ?? ""}-${scope.status ?? "all"}${query}` : null;
  const { data, error, isLoading, mutate } = useSWR(key, () => get<AttendanceChangeRequestRow[]>(`/attendance/change-requests${query}`));
  const items = data?.data ?? [];
  return {
    items,
    total: Number(data?.meta?.total ?? 0),
    pendingCount: Number(data?.meta?.pendingCount ?? (scope?.status === "PENDING" ? items.length : 0)),
    error,
    isLoading,
    mutate,
  };
}

/**
 * Withdraw a pending request. A 409 (an admin reviewed it first) rejects with
 * an ApiError whose message explains the final state, so the caller can show it
 * and revalidate instead of pretending the cancel succeeded.
 */
export async function cancelAttendanceChangeRequest(requestId: string, note?: string) {
  const response = await post<{ id: string; displayStatus: string; changeCount: number }>(
    `/attendance/change-requests/${requestId}/cancel`,
    note?.trim() ? { note: note.trim() } : {},
  );
  return response.data;
}

/**
 * Revalidate every attendance cache a mutation can invalidate.
 *
 * Keys live in the components that own the data (`t-att-{offering}-{date}`,
 * `att-report-{offering}-…`, `att-records-{session}`, `att-hist-{session}`,
 * `att-change-requests-…`); centralising the matcher keeps a save/cancel/approve
 * from leaving a stale summary, roster or pending badge on screen.
 */
export function useAttendanceRevalidate() {
  const { mutate: globalMutate } = useSWRConfig();
  return async function revalidateAttendance(scope: { courseOfferingId?: string; sessionId?: string } = {}) {
    const { courseOfferingId, sessionId } = scope;
    await globalMutate(
      (key: unknown) => {
        if (typeof key !== "string") return false;
        if (key.startsWith("att-change-requests-")) return true;
        if (courseOfferingId && (key.startsWith(`t-att-${courseOfferingId}-`) || key.startsWith(`att-report-${courseOfferingId}-`))) return true;
        if (sessionId && (key === `att-records-${sessionId}` || key === `att-hist-${sessionId}`)) return true;
        // Nothing scoped: refresh the whole attendance area.
        return !courseOfferingId && !sessionId && key.startsWith("att");
      },
      undefined,
      { revalidate: true },
    );
  };
}
