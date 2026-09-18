import { describe, expect, it } from "vitest";
import {
  NOTICE_ATTACHMENT_MAX_BYTES,
  NOTICE_ATTACHMENT_MAX_COUNT,
  validateNoticeAttachment,
  validateNoticeAttachmentBatch,
} from "@/lib/storage/storage";

const pdf = (body = "notice") => Buffer.from(`%PDF-1.7\n${body}`);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

describe("notice attachment validation", () => {
  it("sniffs an allowed PDF without trusting the browser MIME type", () => {
    const result = validateNoticeAttachment({ name: "../../agenda.exe", type: "application/octet-stream", buffer: pdf() });
    expect(result.mimeType).toBe("application/pdf");
    expect(result.originalName).toBe("agenda.pdf");
    expect(result.extension).toBe("pdf");
  });

  it("accepts image signatures and rejects unsupported bytes", () => {
    expect(validateNoticeAttachment({ name: "poster.png", type: "text/plain", buffer: png }).mimeType).toBe("image/png");
    expect(() => validateNoticeAttachment({ name: "script.exe", type: "application/pdf", buffer: Buffer.from("not a document") })).toThrow("Unsupported attachment type");
  });

  it("enforces the per-file and batch limits", () => {
    const tooLarge = Buffer.alloc(NOTICE_ATTACHMENT_MAX_BYTES + 1, 0);
    expect(() => validateNoticeAttachment({ name: "large.txt", type: "text/plain", buffer: tooLarge })).toThrow("25 MB");
    const tooMany = Array.from({ length: NOTICE_ATTACHMENT_MAX_COUNT + 1 }, (_, index) => ({
      name: `file-${index}.pdf`,
      buffer: pdf(String(index)),
    }));
    expect(() => validateNoticeAttachmentBatch(tooMany)).toThrow(`${NOTICE_ATTACHMENT_MAX_COUNT}`);
  });
});
