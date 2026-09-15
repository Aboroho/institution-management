/** UI-safe parsing of the API's Zod flatten() details. Ignore unknown detail shapes. */
export function validationDetails(details: unknown): { fieldErrors: Record<string, string[]>; formErrors: string[] } {
  const result = { fieldErrors: Object.create(null) as Record<string, string[]>, formErrors: [] as string[] };
  if (!details || typeof details !== "object") return result;
  const value = details as Record<string, unknown>;
  const messages = (v: unknown) => Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.length > 0) : [];
  result.formErrors = messages(value.formErrors);
  if (value.fieldErrors && typeof value.fieldErrors === "object" && !Array.isArray(value.fieldErrors)) {
    for (const [key, errors] of Object.entries(value.fieldErrors)) {
      const valid = messages(errors);
      if (valid.length) result.fieldErrors[key] = valid;
    }
  }
  return result;
}

export function fieldLabel(path: string): string {
  return path.split(".").map((part) => {
    if (/^\d+$/.test(part)) return `item ${Number(part) + 1}`;
    const label = part.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").replace(/\bId\b/g, "ID");
    return label.charAt(0).toUpperCase() + label.slice(1);
  }).join(" → ");
}

export function validationMessage(details: unknown, fallback?: string): string {
  const { fieldErrors, formErrors } = validationDetails(details);
  const messages = [...Object.entries(fieldErrors).map(([field, errors]) => `${fieldLabel(field)}: ${errors.join(" ")}`), ...formErrors];
  return messages.length ? `Please check the following: ${messages.join("; ")}` : fallback && fallback !== "Validation failed" ? fallback : "Please check your inputs and try again.";
}

export interface ValidatableField {
  name: string; label: string; type?: string; required?: boolean;
}

/** Upper bound accepted for roll numbers; mirrors the API's Zod field in validation/common. */
export const ROLL_MAX = 999999;

/**
 * Client-side mirror of the API's roll number rules (src/lib/validation/common.ts).
 * UX only — the backend stays authoritative and re-validates everything, including
 * section-scoped uniqueness. Returns the first issue for the raw input, or null.
 */
export function rollNumberIssue(raw: unknown): string | null {
  if (raw == null || String(raw).trim() === "") return "Roll number is required.";
  const value = Number(raw);
  if (!Number.isFinite(value)) return "Enter a valid number.";
  if (!Number.isInteger(value)) return "Roll number must be a whole number.";
  if (value < 1) return "Roll number must be 1 or greater.";
  if (value > ROLL_MAX) return `Roll number is too large (maximum ${ROLL_MAX}).`;
  return null;
}

/** Basic UX checks only. Domain constraints remain enforced by the API. */
export function validateFields(fields: ValidatableField[], values: Record<string, unknown>): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const field of fields) {
    const value = values[field.name];
    const empty = value == null || (typeof value === "string" && !value.trim());
    let message = "";
    if (field.required && (empty || (field.type === "checkbox" && !value))) message = `${field.label} is required.`;
    else if (!empty && field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) message = "Enter a valid email address, such as name@example.com.";
    else if (!empty && field.type === "number" && !Number.isFinite(Number(value))) message = "Enter a valid number.";
    else if (!empty && ["date", "datetime"].includes(field.type ?? "") && Number.isNaN(Date.parse(String(value)))) message = "Enter a valid date.";
    if (message) errors[field.name] = [message];
  }
  return errors;
}
