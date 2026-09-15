import type { Prisma } from "@prisma/client";

/**
 * Roll numbers are unique inside a section (`sectionId + rollNumber`) and are never reused
 * while the enrollment row exists, so the next free number follows the highest one in use.
 */
export function nextRollNumber(usedRollNumbers: readonly number[]): number {
  let highest = 0;
  for (const value of usedRollNumbers) {
    if (Number.isInteger(value) && value > highest) highest = value;
  }
  return highest + 1;
}

/**
 * Next roll number available in a section. Used where the system creates the enrollment
 * itself (promotion / repetition) — admin-driven enrollment always supplies the roll number.
 */
export async function nextSectionRollNumber(db: Prisma.TransactionClient, sectionId: string): Promise<number> {
  const rows = await db.studentEnrollment.findMany({
    where: { sectionId },
    select: { rollNumber: true },
  });
  return nextRollNumber(rows.map((row: any) => row.rollNumber));
}
