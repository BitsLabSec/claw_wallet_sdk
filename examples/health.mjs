/**
 * Run after `npm run build` from package root:
 *   node examples/health.mjs
 *
 * Optional: CLAY_SANDBOX_URL, CLAY_AGENT_TOKEN
 */
import { createClawWalletClient } from "../dist/index.js";

const baseUrl = process.env.CLAY_SANDBOX_URL ?? "http://127.0.0.1:9000";
const agentToken = process.env.CLAY_AGENT_TOKEN?.trim() ?? "";

const client = createClawWalletClient({
  baseUrl,
  agentToken: agentToken || undefined,
});

const { data, error, response } = await client.GET("/health", {});

if (error) {
  console.error("error", error);
  process.exit(1);
}
console.log("status", response.status, data);
