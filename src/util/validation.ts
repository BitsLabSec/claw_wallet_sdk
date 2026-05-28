import { ClawValidationError } from "../errors.js";

export function requireNonEmpty(value: unknown, field: string, context: string): string {
  if (typeof value === "string" && value.trim()) return value;
  throw new ClawValidationError(`${context}: ${field} is required`, { field });
}

export function optionalNonEmpty(value: unknown, field: string, context: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requireNonEmpty(value, field, context);
}

export function requireUrl(value: unknown, field: string, context: string): string {
  const url = requireNonEmpty(value, field, context);
  try {
    return new URL(url).toString().replace(/\/+$/, "");
  } catch (cause) {
    throw new ClawValidationError(`${context}: ${field} must be a valid URL`, { field, cause });
  }
}

export function requireOneOf(
  fields: ReadonlyArray<readonly [string, unknown]>,
  context: string,
): void {
  if (fields.some(([, value]) => typeof value === "string" && value.trim())) return;
  const names = fields.map(([field]) => field).join(" or ");
  throw new ClawValidationError(`${context}: ${names} is required`, {
    field: fields[0]?.[0],
  });
}
