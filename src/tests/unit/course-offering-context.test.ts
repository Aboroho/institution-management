import { describe, it, expect } from "vitest";
import { offeringContextCode, offeringAvailable, withOfferingContext } from "@/lib/course-offering-context";

const offering = {
  id: "cux1",
  isActive: true,
  course: { id: "c1", code: "DE-101", title: "Digital Electronics" },
  trade: { id: "t1", code: "EC", name: "Electronics" },
  semester: { id: "s1", number: 2, name: "Semester 2" },
  shift: { id: "sh1", code: "M", name: "Morning" },
  section: { id: "sec1", name: "A" },
  academicYear: { id: "y1", name: "2026-27", isActive: true },
};

describe("offeringContextCode", () => {
  it("follows {course_name}-{trade_code}-{semester_number}-{shift_first_letter}-{section_name}", () => {
    expect(offeringContextCode(offering)).toBe("Digital Electronics-EC-2-M-A");
  });

  it("uses the semester NUMBER, not its name", () => {
    expect(offeringContextCode({ ...offering, semester: { number: 3, name: "Semester 3" } })).toBe(
      "Digital Electronics-EC-3-M-A"
    );
  });

  it("uses only the first letter of the shift name", () => {
    expect(offeringContextCode({ ...offering, shift: { name: "Evening" } })).toBe("Digital Electronics-EC-2-E-A");
  });

  it("is stable to whitespace and upper-cases the shift letter", () => {
    expect(
      offeringContextCode({
        ...offering,
        course: { title: "  Digital Electronics  " },
        shift: { name: "morning" },
        section: { name: " A " },
      })
    ).toBe("Digital Electronics-EC-2-M-A");
  });

  it("skips missing parts instead of emitting empty segments", () => {
    expect(offeringContextCode({ course: { title: "Maths" }, trade: { code: "MT" } })).toBe("Maths-MT");
    expect(offeringContextCode(null)).toBe("");
    expect(offeringContextCode(undefined)).toBe("");
  });
});

describe("offeringAvailable (derives from offering + academic year status)", () => {
  it("is true when both the offering and its academic year are active", () => {
    expect(offeringAvailable(offering)).toBe(true);
  });

  it("is false when the offering is inactive", () => {
    expect(offeringAvailable({ ...offering, isActive: false })).toBe(false);
  });

  it("is false when the academic year is inactive, even if the offering flag is still true", () => {
    expect(offeringAvailable({ ...offering, academicYear: { isActive: false } })).toBe(false);
  });

  it("falls back to the offering flag when the year was not loaded on the payload", () => {
    const { academicYear, ...rest } = offering;
    expect(offeringAvailable(rest)).toBe(true);
    expect(offeringAvailable({ ...rest, isActive: false })).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(offeringAvailable(null)).toBe(false);
    expect(offeringAvailable(undefined)).toBe(false);
  });
});

describe("withOfferingContext", () => {
  it("adds derived context + available fields without mutating the row", () => {
    const out = withOfferingContext(offering);
    expect(out.context).toBe("Digital Electronics-EC-2-M-A");
    expect(out.available).toBe(true);
    expect("context" in offering).toBe(false);
    // original identifier is untouched — context is never the DB id
    expect(out.id).toBe("cux1");
  });

  it("reflects an inactive academic year", () => {
    const out = withOfferingContext({ ...offering, academicYear: { isActive: false } });
    expect(out.available).toBe(false);
  });
});
