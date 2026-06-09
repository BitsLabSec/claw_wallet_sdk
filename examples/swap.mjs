/**
 * Run after `npm run build` from package root:
 *   CLAY_SANDBOX_URL="http://127.0.0.1:9000" \
 *   CLAY_AGENT_TOKEN="your_token" \
 *   CLAY_SWAP_KIND="evm" \
 *   CLAY_SWAP_TOKEN_OUT="0x..." \
 *   CLAY_SWAP_AMOUNT="1000000000000000" \
 *   node examples/swap.mjs
 *
 * CLAY_SWAP_KIND can be `evm`, `solana`, or `sui`.
 */
import { ClawWallet } from "../dist/index.js";

const sandboxUrl = process.env.CLAY_SANDBOX_URL ?? "http://127.0.0.1:9000";
const token = process.env.CLAY_AGENT_TOKEN?.trim() ?? "";
const kind = (process.env.CLAY_SWAP_KIND ?? "evm").trim().toLowerCase();
const tokenIn = process.env.CLAY_SWAP_TOKEN_IN?.trim() || "native";
const tokenOut = process.env.CLAY_SWAP_TOKEN_OUT?.trim() || "";
const amount = process.env.CLAY_SWAP_AMOUNT?.trim() || "";

if (!tokenOut) throw new Error("missing CLAY_SWAP_TOKEN_OUT");
if (!amount) throw new Error("missing CLAY_SWAP_AMOUNT");

const claw = new ClawWallet({ sandboxUrl, token });

let result;
if (kind === "evm") {
  result = await claw.swap.evm({
    chain: process.env.CLAY_SWAP_CHAIN?.trim() || "base",
    tokenIn,
    tokenOut,
    amountIn: amount,
    slippageTolerance: Number(process.env.CLAY_SWAP_SLIPPAGE_TOLERANCE ?? 50),
  });
} else if (kind === "solana") {
  result = await claw.swap.solana({
    tokenIn,
    tokenOut,
    amountIn: amount,
    slippageBps: Number(process.env.CLAY_SWAP_SLIPPAGE_BPS ?? 75),
  });
} else if (kind === "sui") {
  result = await claw.swap.sui({
    tokenIn,
    tokenOut,
    amount,
  });
} else {
  throw new Error("CLAY_SWAP_KIND must be evm, solana, or sui");
}

console.log("swap result", JSON.stringify(result, null, 2));
