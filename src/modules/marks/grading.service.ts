// GradingService — single home for final-grade calculations.
// UI must display values produced here, never compute its own final grades.

export interface GradableAssessment {
  id: string;
  totalMarks: number;
  passMarks: number;
  countsTowardFinal: boolean;
  weight: number | null;
  marksObtained: number | null; // null = not yet graded
}

export interface GradeResult {
  totalObtained: number;
  totalPossible: number;
  percentage: number;
  passed: boolean;
  grade: string;
  complete: boolean; // all counted assessments graded
}

const GRADE_TABLE: { min: number; grade: string }[] = [
  { min: 80, grade: "A+" },
  { min: 75, grade: "A" },
  { min: 70, grade: "A-" },
  { min: 65, grade: "B+" },
  { min: 60, grade: "B" },
  { min: 55, grade: "B-" },
  { min: 50, grade: "C+" },
  { min: 45, grade: "C" },
  { min: 40, grade: "D" },
  { min: 0, grade: "F" },
];

export function gradeForPercentage(pct: number): string {
  for (const row of GRADE_TABLE) if (pct >= row.min) return row.grade;
  return "F";
}

/**
 * Weighted grading:
 * - Only countsTowardFinal assessments are included.
 * - If weights are present, normalize to 100 across counted assessments.
 * - Otherwise, percentage = obtained/possible across counted assessments.
 * - Pass requires overall percentage >= 40 AND every counted assessment >= its passMarks
 *   (strict but documented; future rules can evolve here without touching UI).
 */
export function computeFinalGrade(items: GradableAssessment[]): GradeResult {
  const counted = items.filter((a) => a.countsTowardFinal);
  const totalPossible = counted.reduce((s, a) => s + a.totalMarks, 0);
  const graded = counted.filter((a) => a.marksObtained !== null);
  const complete = counted.length > 0 && graded.length === counted.length;

  const hasWeights = counted.some((a) => a.weight !== null && a.weight !== undefined);
  let percentage = 0;
  let totalObtained = 0;

  if (counted.length && totalPossible > 0) {
    if (hasWeights) {
      const weightSum = counted.reduce((s, a) => s + (a.weight ?? 0), 0) || 1;
      percentage =
        counted.reduce((s, a) => {
          const obtained = a.marksObtained ?? 0;
          const ratio = a.totalMarks > 0 ? obtained / a.totalMarks : 0;
          return s + ratio * ((a.weight ?? 0) / weightSum) * 100;
        }, 0);
      totalObtained = graded.reduce((s, a) => s + (a.marksObtained ?? 0), 0);
    } else {
      totalObtained = graded.reduce((s, a) => s + (a.marksObtained ?? 0), 0);
      percentage = (totalObtained / totalPossible) * 100;
    }
  }

  percentage = Math.round(percentage * 10) / 10;
  const allPassed = counted.every((a) =>
    a.marksObtained === null ? false : a.marksObtained >= a.passMarks
  );
  const passed = complete && percentage >= 40 && allPassed;
  return {
    totalObtained: Math.round(totalObtained * 100) / 100,
    totalPossible,
    percentage,
    passed: counted.length === 0 ? false : passed,
    grade: counted.length === 0 ? "N/A" : gradeForPercentage(percentage),
    complete,
  };
}
