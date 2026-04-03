/**
 * Core entry: OpenAPI client + Sandbox wrapper + encoding/signing helpers.
 * Does not load viem, ethers, Solana, or Sui — those are optional subpaths:
 * - `claw_wallet_sdk/viem`
 * - `claw_wallet_sdk/ethers`
 * - `claw_wallet_sdk/solana`
 * - `claw_wallet_sdk/sui`
 */
export {
  createClawWalletClient,
  type ClawWalletClient,
  type ClawWalletClientOptions,
} from "./client.js";
export type { paths, components } from "./generated/paths.js";
export {
  utf8ToPayloadHex,
  bytesToHex,
  hexToBytes,
  stripHexPrefix,
  toBase64,
} from "./encoding.js";
export {
  ClawSandboxClient,
  type ClawAssetSnapshot,
  type ClawBroadcastRequest,
  type ClawBroadcastResponse,
  type ClawSignerConfig,
  type ClawSignRequest,
  type ClawSignResult,
  type ClawPolicy,
  type ClawPolicyAddressNote,
  type ClawPolicyUpdatePatch,
  type ClawStatusMessage,
  type ClawTransferRequest,
  type ClawTransferResult,
  type ClawWalletBindRequest,
  type ClawWalletBindResult,
  type ClawWalletHistory,
  type ClawWalletHistoryEntry,
  type ClawWalletInitRequest,
  type ClawWalletInitResponse,
  type ClawWalletUnlockRequest,
  type ClawWalletStatus,
} from "./sandbox.js";
export {
  buildPersonalSignBody,
  type PersonalSignRequestInput,
} from "./signing.js";
