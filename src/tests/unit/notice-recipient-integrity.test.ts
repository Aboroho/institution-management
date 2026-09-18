import { describe, expect, it } from "vitest";
import { uniqueRecipientIds } from "@/lib/notifications/recipient-utils";

describe("notice recipient integrity", () => {
  it("deduplicates recipients while preserving first-seen order", () => {
    expect(uniqueRecipientIds(["student-1", "teacher-1", "student-1", "student-2", "teacher-1"]))
      .toEqual(["student-1", "teacher-1", "student-2"]);
  });
});
