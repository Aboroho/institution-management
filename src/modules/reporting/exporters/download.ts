import { AppError } from "@/lib/errors/errors";

/**
 * Downloads a GeneratedReportFile in the browser using a temporary Blob URL,
 * and releases the object URL immediately afterwards.
 */
export function downloadReportFile(file: {
  filename: string;
  mimeType: string;
  data: Uint8Array | ArrayBuffer | Blob;
}) {
  if (typeof window === "undefined") {
    throw new Error("downloadReportFile can only be called in a browser environment");
  }

  const blob =
    file.data instanceof Blob
      ? file.data
      : new Blob([file.data as BlobPart], { type: file.mimeType });

  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();

  // Clean up resources immediately
  setTimeout(() => {
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }, 100);
}
