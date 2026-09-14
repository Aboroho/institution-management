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

export interface Storage {
  put(buffer: Buffer, opts: { key: string; contentType: string }): Promise<{ bucket: string }>;
  remove(key: string): Promise<void>;
  getSignedDownloadUrl(key: string): Promise<string>;
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

  async getSignedDownloadUrl(key: string): Promise<string> {
    return `/api/v1/submissions/file?key=${encodeURIComponent(key)}`;
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

  async getSignedDownloadUrl(key: string): Promise<string> {
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
