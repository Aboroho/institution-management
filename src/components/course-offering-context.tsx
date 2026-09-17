"use client";
/**
 * Course-offering context components.
 *
 * Everywhere a course is mentioned (attendance take/report, assessments, marks,
 * notices, schedules, assignments, approvals), the trade / semester / shift /
 * section it belongs to must be visible too — with distinct colors so a
 * teacher or admin can tell at a glance that they are in the correct course.
 *
 * Color key (stable across the whole app):
 *   Academic year -> slate, Trade -> blue, Semester -> violet,
 *   Shift -> amber, Section -> green, Course code -> brand.
 */

import { BookOpen, CalendarDays, Clock, GraduationCap, Layers, Users } from "lucide-react";
import { Badge } from "@/components/ui";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export function offeringParts(offering: Row | null | undefined) {
  const o = offering ?? {};
  return {
    courseTitle: str((o.course as Row | undefined)?.title),
    courseCode: str((o.course as Row | undefined)?.code),
    year: str((o.academicYear as Row | undefined)?.name),
    trade: str((o.trade as Row | undefined)?.name),
    tradeCode: str((o.trade as Row | undefined)?.code),
    semester: str((o.semester as Row | undefined)?.name),
    shift: str((o.shift as Row | undefined)?.name),
    section: str((o.section as Row | undefined)?.name),
  };
}

/** Single-line full context, e.g. for dropdown options and table fallbacks. */
export function offeringContextLabel(offering: Row | null | undefined) {
  const p = offeringParts(offering);
  const head = p.courseTitle + (p.courseCode ? ` (${p.courseCode})` : "");
  const tail = [p.trade, p.semester, p.shift, p.section && `Sec ${p.section}`]
    .filter(Boolean)
    .join(" · ");
  return tail ? `${head} · ${tail}` : head;
}

/** Search haystack covering every context dimension. */
export function offeringSearchText(offering: Row | null | undefined) {
  const p = offeringParts(offering);
  return [p.courseTitle, p.courseCode, p.year, p.trade, p.tradeCode, p.semester, p.shift, p.section]
    .join(" ")
    .toLowerCase();
}

export function CourseOfferingBadges({
  offering,
  showYear = true,
  showCourseCode = false,
}: {
  offering: Row | null | undefined;
  showYear?: boolean;
  showCourseCode?: boolean;
}) {
  const p = offeringParts(offering);
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {showCourseCode && p.courseCode && (
        <Badge tone="slate">
          <span className="flex items-center gap-1" title="Course code">
            <BookOpen size={12} /> {p.courseCode}
          </span>
        </Badge>
      )}
      {showYear && p.year && (
        <Badge tone="slate">
          <span className="flex items-center gap-1" title="Academic year">
            <CalendarDays size={12} /> {p.year}
          </span>
        </Badge>
      )}
      {p.trade && (
        <Badge tone="blue">
          <span className="flex items-center gap-1" title="Trade">
            <GraduationCap size={12} /> {p.trade}
          </span>
        </Badge>
      )}
      {p.semester && (
        <Badge tone="violet">
          <span className="flex items-center gap-1" title="Semester">
            <Layers size={12} /> {p.semester}
          </span>
        </Badge>
      )}
      {p.shift && (
        <Badge tone="amber">
          <span className="flex items-center gap-1" title="Shift">
            <Clock size={12} /> {p.shift}
          </span>
        </Badge>
      )}
      {p.section && (
        <Badge tone="green">
          <span className="flex items-center gap-1" title="Section">
            <Users size={12} /> Sec {p.section}
          </span>
        </Badge>
      )}
    </span>
  );
}

/**
 * Prominent gradient banner for pages where acting in the wrong course would
 * be costly (take attendance, edit attendance, attendance report, assessments,
 * marks). Rendered above tabs/forms so the context is always visible.
 */
export function CourseOfferingBanner({
  offering,
  eyebrow,
  action,
}: {
  offering: Row | null | undefined;
  /** Small uppercase label above the title, e.g. "Taking attendance for". */
  eyebrow?: string;
  action?: React.ReactNode;
}) {
  const p = offeringParts(offering);
  return (
    <div className="mb-5 overflow-hidden rounded-xl border border-blue-100 bg-gradient-to-r from-blue-50 via-violet-50 to-emerald-50 shadow-sm">
      <div className="flex flex-wrap items-center gap-4 p-4">
        <span className="rounded-xl bg-gradient-to-br from-brand-600 to-violet-600 p-3 text-white shadow-sm">
          <BookOpen size={22} />
        </span>
        <div className="min-w-[220px] flex-1">
          {eyebrow && (
            <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-700">
              {eyebrow}
            </p>
          )}
          <p className="text-lg font-bold leading-tight text-slate-900">
            {p.courseTitle || "Course offering"}
            {p.courseCode && (
              <span className="ml-2 align-middle text-xs font-semibold text-slate-500">
                {p.courseCode}
              </span>
            )}
          </p>
          <div className="mt-2">
            <CourseOfferingBadges offering={offering} />
          </div>
        </div>
        {action && <div className="flex flex-wrap gap-2">{action}</div>}
      </div>
    </div>
  );
}

/** Compact cell for tables that mention a course offering. */
export function CourseOfferingCell({ offering }: { offering: Row | null | undefined }) {
  const p = offeringParts(offering);
  return (
    <span className="block">
      <span className="block font-medium text-slate-800">{p.courseTitle || "—"}</span>
      {p.courseCode && <span className="block text-xs text-slate-400">{p.courseCode}</span>}
      <span className="mt-1 block">
        <CourseOfferingBadges offering={offering} showYear={false} />
      </span>
    </span>
  );
}
