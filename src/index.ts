/**
 * Core entry: OpenAPI client + Sandbox wrapper + encoding/signing helpers.
 */
export { ClawWallet } from "./claw-wallet.js";
export type * from "./claw-wallet.js";
export { createClawWalletClient } from "./client.js";
export type * from "./client.js";
export type { paths, components } from "./generated/paths.js";
export { ClawSDKError, ClawValidationError } from "./errors.js";
export type { ClawSDKErrorOptions } from "./errors.js";
export {
  utf8ToPayloadHex,
  bytesToHex,
  hexToBytes,
  stripHexPrefix,
  toBase64,
} from "./util/encoding.js";
export { ClawSandboxClient } from "./sandbox.js";
export type * from "./sandbox.js";
export { buildPersonalSignBody } from "./util/signing.js";
export type * from "./util/signing.js";
