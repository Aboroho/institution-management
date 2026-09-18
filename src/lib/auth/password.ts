import bcrypt from "bcryptjs";
import { passwordMinLength } from "@/lib/validation/common";

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Secondary enforcement of the password policy (see `passwordField` in
 * `src/lib/validation/common.ts`, which is what request schemas use). Callers that
 * already validated input still call this so the rule also holds for any future
 * non-HTTP caller, and so a policy change cannot be bypassed by an old client.
 * Throws a plain Error: it signals a programming error at a validation boundary,
 * not an end-user message.
 */
export function assertPasswordStrength(password: string) {
  if (typeof password !== "string" || password.length < passwordMinLength) {
    throw new Error(`Password must be at least ${passwordMinLength} characters`);
  }
}
