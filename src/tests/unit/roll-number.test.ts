import { describe, it, expect } from "vitest";
import { rollNumber } from "@/lib/validation/common";
import { nextRollNumber } from "@/modules/students/roll";

// The roll number is a required student field, unique inside a section
// (`StudentEnrollment @@unique([sectionId, rollNumber])`).
describe("roll number validation", () => {
  it("accepts whole numbers, numeric strings and whitespace padding", () => {
    expect(rollNumber.parse(12)).toBe(12);
    expect(rollNumber.parse("12")).toBe(12);
    expect(rollNumber.parse(" 007 ")).toBe(7);
    expect(rollNumber.parse(999999)).toBe(999999);
  });

  it("requires a value", () => {
    for (const value of [undefined, null, "", "   "]) {
      const result = rollNumber.safeParse(value);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0].message).toBe("Roll number is required");
    }
  });

  it("rejects zero, negative, fractional and non-numeric values", () => {
    for (const value of [0, -3, 1.5, "abc", 1000000]) {
      expect(rollNumber.safeParse(value).success).toBe(false);
    }
  });
});

describe("next roll number inside a section", () => {
  it("starts at 1 for a section without enrollments", () => {
    expect(nextRollNumber([])).toBe(1);
  });

  it("follows the highest roll already in use (gaps are not reused)", () => {
    expect(nextRollNumber([1, 2, 3])).toBe(4);
    expect(nextRollNumber([3, 1, 2])).toBe(4);
    expect(nextRollNumber([1, 2, 5])).toBe(6);
    expect(nextRollNumber([4, 4, 2])).toBe(5);
  });

  it("ignores entries that are not valid roll numbers", () => {
    expect(nextRollNumber([0, -2, 1.5, 7])).toBe(8);
  });
});
