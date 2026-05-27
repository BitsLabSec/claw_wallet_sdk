import type { components } from "../generated/paths.js";
import type { ClawSandboxClient } from "../sandbox.js";

export type Schema<Name extends keyof components["schemas"]> = components["schemas"][Name];

export type ClawOperationClient = Pick<ClawSandboxClient, "client" | "config">;

export type ClawInvokeResult = Record<string, unknown>;

export function coalesce<T>(first: T | undefined, second: T | undefined): T | undefined {
  return first !== undefined ? first : second;
}

export function withUid<T extends { uid?: string }>(request: T | undefined, uid: string): T & { uid: string } {
  return {
    ...(request ?? {} as T),
    uid: request?.uid ?? uid,
  };
}

export function errorText(error: unknown, response: Response): string {
  if (typeof error === "string" && error) return error;
  return response.statusText || "Unknown error";
}
