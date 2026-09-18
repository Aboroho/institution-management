import { promises as fs } from "fs";
import path from "path";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Private object storage for assessment submissions (PDF-only).
 *
 * Production uses an S3-compatible store (MinIO / AWS S3 / R2) with
 * short-lived signed download URLs. When S3 is not configured (dev),
 * files fall back to the local filesystem and are served through the
 * authorized `/api/v1/submissions/file` route.
 */

export const SUBMISSION_MAX_BYTES = 50 * 1024 * 1024; // 50 MB
export const NOTICE_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024; // 25 MB per file
export const NOTICE_ATTACHMENT_MAX_COUNT = 10;
export const NOTICE_ATTACHMENT_MAX_TOTAL_BYTES = 100 * 1024 * 1024;

export interface NoticeAttachmentUpload {
  name: string;
  type?: string;
  size?: number;
  buffer: Buffer;
}

export interface ValidatedNoticeAttachment {
  originalName: string;
  mimeType: string;
  extension: string;
  size: number;
  buffer: Buffer;
}

export function validatePdfUpload(file: { name: string; type: string; size: number }) {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("Only PDF files are allowed");
  }
  if (file.type !== "application/pdf") {
    throw new Error("Only PDF files are allowed (invalid MIME type)");
  }
  if (file.size > SUBMISSION_MAX_BYTES) {
    throw new Error("File exceeds 50 MB limit");
  }
}

function safeOriginalName(name: string): string {
  const withoutPath = name.replace(/\\/g, "/").split("/").pop() ?? "";
  const cleaned = withoutPath.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const base = cleaned || "attachment";
  return base.slice(0, 180);
}

function extensionOf(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match ? match[1].toLowerCase() : "";
}

function hasPrefix(buffer: Buffer, prefix: number[]): boolean {
  return prefix.every((value, index) => buffer[index] === value);
}

function hasAscii(buffer: Buffer, offset: number, value: string): boolean {
  return buffer.subarray(offset, offset + value.length).toString("ascii") === value;
}

/**
 * Validate and sniff notice attachments from their bytes. The browser MIME type
 * is deliberately ignored; it is only a UX hint and is not an authorization or
 * validation boundary.
 */
export function validateNoticeAttachment(file: NoticeAttachmentUpload): ValidatedNoticeAttachment {
  const buffer = file.buffer;
  if (buffer.length === 0) throw new Error("Empty files cannot be attached");
  if (buffer.length > NOTICE_ATTACHMENT_MAX_BYTES) throw new Error("Each attachment must be 25 MB or smaller");

  let mimeType: string | null = null;
  let extension = "";
  if (hasAscii(buffer, 0, "%PDF-")) {
    mimeType = "application/pdf";
    extension = "pdf";
  } else if (hasPrefix(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    mimeType = "image/png";
    extension = "png";
  } else if (hasPrefix(buffer, [0xff, 0xd8, 0xff])) {
    mimeType = "image/jpeg";
    extension = "jpg";
  } else if (hasAscii(buffer, 0, "GIF8")) {
    mimeType = "image/gif";
    extension = "gif";
  } else if (hasAscii(buffer, 0, "RIFF") && hasAscii(buffer, 8, "WEBP")) {
    mimeType = "image/webp";
    extension = "webp";
  } else if (hasPrefix(buffer, [0x50, 0x4b, 0x03, 0x04])) {
    const inputExtension = extensionOf(file.name);
    const officeTypes: Record<string, { mimeType: string; extension: string }> = {
      docx: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extension: "docx" },
      xlsx: { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extension: "xlsx" },
      pptx: { mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", extension: "pptx" },
    };
    const office = officeTypes[inputExtension];
    if (office) {
      mimeType = office.mimeType;
      extension = office.extension;
    }
  } else {
    const inputExtension = extensionOf(file.name);
    if (inputExtension === "txt" || inputExtension === "csv") {
      const hasNullByte = buffer.includes(0);
      if (!hasNullByte) {
        mimeType = inputExtension === "csv" ? "text/csv" : "text/plain";
        extension = inputExtension;
      }
    }
  }

  if (!mimeType || !extension) {
    throw new Error("Unsupported attachment type. Use PDF, PNG, JPEG, GIF, WebP, DOCX, XLSX, PPTX, TXT or CSV files");
  }

  const originalBase = safeOriginalName(file.name).replace(/\..*$/i, "") || "attachment";
  return {
    originalName: `${originalBase.slice(0, 170)}.${extension}`,
    mimeType,
    extension,
    size: buffer.length,
    buffer,
  };
}

export function validateNoticeAttachmentBatch(files: NoticeAttachmentUpload[]): ValidatedNoticeAttachment[] {
  if (files.length > NOTICE_ATTACHMENT_MAX_COUNT) {
    throw new Error(`You can attach at most ${NOTICE_ATTACHMENT_MAX_COUNT} files`);
  }
  const validated = files.map(validateNoticeAttachment);
  const total = validated.reduce((sum, file) => sum + file.size, 0);
  if (total > NOTICE_ATTACHMENT_MAX_TOTAL_BYTES) {
    throw new Error("The combined attachment size must be 100 MB or smaller");
  }
  return validated;
}

export interface Storage {
  put(buffer: Buffer, opts: { key: string; contentType: string }): Promise<{ bucket: string }>;
  remove(key: string): Promise<void>;
  getSignedDownloadUrl(key: string, localFallbackPath?: string): Promise<string>;
  getBuffer(key: string): Promise<Buffer>;
}

function isS3Configured(): boolean {
  return Boolean(process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY);
}

// ---------------------------------------------------------------------------
// Local filesystem storage (dev fallback)
// ---------------------------------------------------------------------------

const localDir = () => path.resolve(process.cwd(), process.env.LOCAL_STORAGE_DIR || "./storage");

class LocalStorage implements Storage {
  private pathFor(key: string): string {
    const target = path.resolve(localDir(), key);
    if (!target.startsWith(localDir() + path.sep)) {
      throw new Error("Invalid storage key");
    }
    return target;
  }

  async put(buffer: Buffer, { key }: { key: string; contentType: string }): Promise<{ bucket: string }> {
    const filePath = this.pathFor(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
    return { bucket: "local" };
  }

  async remove(key: string): Promise<void> {
    try {
      await fs.unlink(this.pathFor(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }

  async getSignedDownloadUrl(key: string, localFallbackPath = "/api/v1/submissions/file"): Promise<string> {
    return `${localFallbackPath}?key=${encodeURIComponent(key)}`;
  }

  async getBuffer(key: string): Promise<Buffer> {
    return fs.readFile(this.pathFor(key));
  }
}

// ---------------------------------------------------------------------------
// S3-compatible storage (production)
// ---------------------------------------------------------------------------

function s3Client(): S3Client {
  return new S3Client({
    region: process.env.S3_REGION || "us-east-1",
    endpoint: process.env.S3_ENDPOINT || undefined,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY!,
      secretAccessKey: process.env.S3_SECRET_KEY!,
    },
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  });
}

class S3Storage implements Storage {
  private bucket(): string {
    const b = process.env.S3_BUCKET;
    if (!b) throw new Error("S3_BUCKET is not configured");
    return b;
  }

  async put(buffer: Buffer, { key, contentType }: { key: string; contentType: string }): Promise<{ bucket: string }> {
    await s3Client().send(
      new PutObjectCommand({
        Bucket: this.bucket(),
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    );
    return { bucket: this.bucket() };
  }

  async remove(key: string): Promise<void> {
    await s3Client().send(new DeleteObjectCommand({ Bucket: this.bucket(), Key: key }));
  }

  async getSignedDownloadUrl(key: string, _localFallbackPath?: string): Promise<string> {
    const client = s3Client();
    const command = new GetObjectCommand({ Bucket: this.bucket(), Key: key });
    return getSignedUrl(client, command, { expiresIn: 15 * 60 }); // 15 minutes
  }

  async getBuffer(key: string): Promise<Buffer> {
    const res = await s3Client().send(new GetObjectCommand({ Bucket: this.bucket(), Key: key }));
    const body = res.Body;
    if (!body) throw new Error("Object not found");
    // Body is a stream in Node; collect into a Buffer.
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Buffer>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}

export const storage: Storage = isS3Configured() ? new S3Storage() : new LocalStorage();
