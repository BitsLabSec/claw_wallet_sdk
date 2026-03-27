/**
 * Use this flow when an AI agent or a third-party service needs to bind a wallet.
 *
 * Important: you must obtain `message_hash_hex` (the bind challenge hash) before calling this API.
 * - `message_hash_hex` is a 32-byte challenge hash issued by the backend/relay (0x..., length 66)
 * - The SDK asks the sandbox to sign the hash with the master key and forwards it to the relay to complete binding
 *
 * Run from the package root:
 *   npm run build
 *
 * Then run:
 *   CLAY_SANDBOX_URL="http://127.0.0.1:9000" \
 *   CLAY_AGENT_TOKEN="your_token" \
 *   CLAY_UID="your_uid" \
 *   CLAY_MESSAGE_HASH_HEX="0x..." \
 *   node examples/wallet-bind.mjs
 */
import { ClawSandboxClient } from "../dist/index.js";

const sandboxUrl = process.env.CLAY_SANDBOX_URL ?? "http://127.0.0.1:9000";
const sandboxToken = process.env.CLAY_AGENT_TOKEN?.trim() ?? "";
const uid = process.env.CLAY_UID?.trim() ?? "";
const messageHashHex = process.env.CLAY_MESSAGE_HASH_HEX?.trim() ?? "";

if (!uid) throw new Error("missing CLAY_UID");
if (!messageHashHex) throw new Error("missing CLAY_MESSAGE_HASH_HEX (message_hash_hex)");

const client = new ClawSandboxClient({
  uid,
  sandboxUrl,
  sandboxToken,
});

const res = await client.bindWallet({
  message_hash_hex: messageHashHex,
});

console.log("bindWallet response", res);