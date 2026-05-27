/**
 * Run after `npm run build` from package root:
 *   CLAY_UID="your_uid" \
 *   CLAY_SANDBOX_URL="http://127.0.0.1:9000" \
 *   CLAY_AGENT_TOKEN="your_token" \
 *   CLAY_BRIDGE_FROM_CHAIN_ID="1" \
 *   CLAY_BRIDGE_FROM_ADDRESS="0x..." \
 *   CLAY_BRIDGE_FROM_TOKEN="native" \
 *   CLAY_BRIDGE_AMOUNT="1000000000000000" \
 *   CLAY_BRIDGE_TO_CHAIN_ID="1151111081099710" \
 *   CLAY_BRIDGE_TO_ADDRESS="..." \
 *   CLAY_BRIDGE_TO_TOKEN="USDC" \
 *   node examples/bridge.mjs
 *
 * By default this example requests token metadata and a quote only.
 * Set CLAY_BRIDGE_EXECUTE=1 after user confirmation to submit execution.
 */
import { ClawWallet } from "../dist/index.js";

const uid = process.env.CLAY_UID?.trim() ?? "";
const sandboxUrl = process.env.CLAY_SANDBOX_URL ?? "http://127.0.0.1:9000";
const token = process.env.CLAY_AGENT_TOKEN?.trim() ?? "";

const request = {
  fromChainId: process.env.CLAY_BRIDGE_FROM_CHAIN_ID?.trim() ?? "",
  fromAddress: process.env.CLAY_BRIDGE_FROM_ADDRESS?.trim() ?? "",
  fromToken: process.env.CLAY_BRIDGE_FROM_TOKEN?.trim() ?? "",
  amount: process.env.CLAY_BRIDGE_AMOUNT?.trim() ?? "",
  toChainId: process.env.CLAY_BRIDGE_TO_CHAIN_ID?.trim() ?? "",
  toAddress: process.env.CLAY_BRIDGE_TO_ADDRESS?.trim() ?? "",
  toToken: process.env.CLAY_BRIDGE_TO_TOKEN?.trim() ?? "",
};

if (!uid) throw new Error("missing CLAY_UID");
for (const [key, value] of Object.entries(request)) {
  if (!value) throw new Error(`missing CLAY_BRIDGE_${key.replace(/[A-Z]/g, "_$&").toUpperCase()}`);
}

const claw = new ClawWallet({ uid, sandboxUrl, token });

const tokens = await claw.bridge.lifi.tokens([request.fromChainId, request.toChainId]);
console.log("supported tokens", JSON.stringify(tokens, null, 2));

const quote = await claw.bridge.lifi.quote(request);
console.log("bridge quote", JSON.stringify(quote, null, 2));

if (!/^(1|true|yes)$/i.test(process.env.CLAY_BRIDGE_EXECUTE ?? "")) {
  console.log("set CLAY_BRIDGE_EXECUTE=1 after user confirmation to execute this bridge");
} else {
  const bridge = await claw.bridge.lifi.execute(request);
  console.log("bridge execution", JSON.stringify(bridge, null, 2));

  if (bridge.status === "PENDING" && bridge.final_status_url) {
    const status = await claw.bridge.lifi.getStatus(bridge.final_status_url);
    console.log("bridge status", JSON.stringify(status, null, 2));
  }
}
