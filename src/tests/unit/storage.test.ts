import { describe, it, expect } from "vitest";
import { validatePdfUpload, SUBMISSION_MAX_BYTES } from "@/lib/storage/storage";

describe("validatePdfUpload", () => {
  it("accepts valid pdf", () => {
    expect(() => validatePdfUpload({ name: "homework.pdf", type: "application/pdf", size: 1024 })).not.toThrow();
  });
  it("rejects non-pdf extension", () => {
    expect(() => validatePdfUpload({ name: "homework.docx", type: "application/pdf", size: 100 })).toThrow();
  });
  it("rejects wrong mime", () => {
    expect(() => validatePdfUpload({ name: "homework.pdf", type: "image/png", size: 100 })).toThrow();
  });
  it("rejects oversize", () => {
    expect(() => validatePdfUpload({ name: "big.pdf", type: "application/pdf", size: SUBMISSION_MAX_BYTES + 1 })).toThrow();
  });
});
