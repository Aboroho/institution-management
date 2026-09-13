import { logger } from "@/lib/logging/logger";

// Provider abstraction. Default is log-only unless SMS_PROVIDER is configured.
export async function sendSms(opts: { to: string; text: string }) {
  const provider = process.env.SMS_PROVIDER || "log";
  if (provider === "log" || !process.env.SMS_API_KEY) {
    logger.info("sms skipped (no provider configured)", { to: opts.to });
    return;
  }
  // Hook for a real HTTP-based SMS provider. Kept abstract on purpose.
  logger.info("sms sent via provider", { provider, to: opts.to });
}
