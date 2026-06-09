import type { components } from "../generated/paths.js";
import type { ClawSandboxClient } from "../sandbox.js";
export { createSandboxError, getErrorMessage } from "../errors.js";

export type Schema<Name extends keyof components["schemas"]> = components["schemas"][Name];

export type ClawOperationClient = Pick<ClawSandboxClient, "client" | "config">;

export type ClawInvokeResult = Record<string, unknown>;

export function coalesce<T>(first: T | undefined, second: T | undefined): T | undefined {
  return first !== undefined ? first : second;
}

export function withUid<T extends { uid?: string }>(request: T | undefined, uid?: string): T {
  const next = { ...(request ?? {} as T) };
  if (next.uid === undefined && uid) {
    next.uid = uid;
  }
  return next;
}

export function withOptionalUid<T extends { uid?: string }>(request: T, uid?: string): T {
  return {
    ...request,
    ...(request.uid === undefined && uid ? { uid } : {}),
  };
}
