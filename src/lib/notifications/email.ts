import nodemailer from "nodemailer";
import { logger } from "@/lib/logging/logger";

export async function sendEmail(opts: { to: string; subject: string; text: string; html?: string }) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    logger.info("email skipped (no provider configured)", { to: opts.to, subject: opts.subject });
    return;
  }
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: Number(SMTP_PORT || 587) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  await transporter.sendMail({ from: SMTP_FROM || SMTP_USER, to: opts.to, subject: opts.subject, text: opts.text, html: opts.html });
}
