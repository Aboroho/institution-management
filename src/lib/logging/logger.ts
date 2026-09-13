type Level = "debug" | "info" | "warn" | "error";

function log(level: Level, message: string, fields?: Record<string, unknown>) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(fields ?? {}),
  };
  // Never log secrets — callers must redact.
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (m: string, f?: Record<string, unknown>) => log("debug", m, f),
  info: (m: string, f?: Record<string, unknown>) => log("info", m, f),
  warn: (m: string, f?: Record<string, unknown>) => log("warn", m, f),
  error: (m: string, f?: Record<string, unknown>) => log("error", m, f),
};
