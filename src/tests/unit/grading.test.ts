import { describe, it, expect } from "vitest";
import { computeFinalGrade, gradeForPercentage } from "@/modules/marks/grading.service";

describe("gradeForPercentage", () => {
  it("maps boundaries", () => {
    expect(gradeForPercentage(95)).toBe("A+");
    expect(gradeForPercentage(80)).toBe("A+");
    expect(gradeForPercentage(79)).toBe("A");
    expect(gradeForPercentage(40)).toBe("D");
    expect(gradeForPercentage(39.9)).toBe("F");
  });
});

describe("computeFinalGrade", () => {
  it("computes unweighted percentage and pass", () => {
    const r = computeFinalGrade([
      { id: "a", totalMarks: 100, passMarks: 40, countsTowardFinal: true, weight: null, marksObtained: 80 },
      { id: "b", totalMarks: 50, passMarks: 20, countsTowardFinal: true, weight: null, marksObtained: 40 },
    ]);
    expect(r.totalObtained).toBe(120);
    expect(r.totalPossible).toBe(150);
    expect(r.percentage).toBe(80);
    expect(r.passed).toBe(true);
    expect(r.grade).toBe("A+");
    expect(r.complete).toBe(true);
  });

  it("ignores assessments that do not count toward final", () => {
    const r = computeFinalGrade([
      { id: "a", totalMarks: 100, passMarks: 40, countsTowardFinal: true, weight: null, marksObtained: 50 },
      { id: "b", totalMarks: 100, passMarks: 40, countsTowardFinal: false, weight: null, marksObtained: 0 },
    ]);
    expect(r.totalPossible).toBe(100);
    expect(r.percentage).toBe(50);
  });

  it("fails when any counted assessment is below pass marks", () => {
    const r = computeFinalGrade([
      { id: "a", totalMarks: 100, passMarks: 40, countsTowardFinal: true, weight: null, marksObtained: 90 },
      { id: "b", totalMarks: 100, passMarks: 40, countsTowardFinal: true, weight: null, marksObtained: 10 },
    ]);
    expect(r.passed).toBe(false);
  });

  it("supports weights normalized to 100", () => {
    const r = computeFinalGrade([
      { id: "a", totalMarks: 100, passMarks: 0, countsTowardFinal: true, weight: 30, marksObtained: 100 },
      { id: "b", totalMarks: 100, passMarks: 0, countsTowardFinal: true, weight: 70, marksObtained: 50 },
    ]);
    expect(r.percentage).toBe(65);
  });

  it("marks incomplete when ungraded", () => {
    const r = computeFinalGrade([
      { id: "a", totalMarks: 100, passMarks: 40, countsTowardFinal: true, weight: null, marksObtained: null },
    ]);
    expect(r.complete).toBe(false);
    expect(r.passed).toBe(false);
  });

  it("handles empty input", () => {
    const r = computeFinalGrade([]);
    expect(r.grade).toBe("N/A");
    expect(r.passed).toBe(false);
  });
});
