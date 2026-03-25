/**
 * Read-mostly Sandbox API + ClawSandboxClient helpers.
 * Does not import viem/ethers/solana/sui.
 */
import assert from "node:assert/strict";

import { ClawSandboxClient, createClawWalletClient } from "../dist/index.js";
import { loadIntegrationConfig } from "./load-integration-config.mjs";

const cfg = loadIntegrationConfig();
if (!cfg.agentToken) {
  process.stdout.write("sandbox readonly skipped: missing CLAY_AGENT_TOKEN / AGENT_TOKEN\n");
  process.exit(0);
}

const client = createClawWalletClient({
  baseUrl: cfg.baseUrl,
  agentToken: cfg.agentToken,
});
const { data, response } = await client.GET("/api/v1/wallet/status", {});
assert.equal(response.status, 200, "wallet/status required");

const statusUid = String(data?.uid ?? "").trim();
assert.ok(statusUid, "wallet/status did not include uid");
const envUid = String(process.env.CLAY_UID?.trim() || "").trim();
if (envUid && envUid !== statusUid) {
  throw new Error(`CLAY_UID mismatch: env=${envUid} status=${statusUid}`);
}
const uid = statusUid;

const sandbox = new ClawSandboxClient({
  uid,
  sandboxUrl: cfg.baseUrl,
  sandboxToken: cfg.agentToken,
});

const st = await sandbox.getStatus();
assert.ok(st && (typeof st.status === "string" || st.gateway_status));

const assets = await sandbox.getAssets();
assert.equal(typeof assets, "object");
assert.notEqual(assets, null);

const history = await sandbox.getHistory({ limit: 3 });
assert.ok(Array.isArray(history));

const policyProbe = await client.GET("/api/v1/policy/local", {});
assert.ok(
  policyProbe.response.status === 200 || policyProbe.response.status === 404,
  `unexpected policy status ${policyProbe.response.status}`,
);

const price = await client.GET("/api/v1/price/cache", {});
assert.equal(price.response.status, 200);
assert.ok(price.data !== undefined);

const security = await client.GET("/api/v1/security/cache", {});
assert.equal(security.response.status, 200);
assert.ok(security.data !== undefined);

const audit = await client.GET("/api/v1/audit/logs", {
  params: { query: { limit: 5 } },
});
assert.equal(audit.response.status, 200);
assert.ok(Array.isArray(audit.data));

if (policyProbe.response.status === 404) {
  await assert.rejects(
    () => sandbox.getLocalPolicy(),
    /Failed to get local policy \(404\)/,
  );
} else {
  const policy = await sandbox.getLocalPolicy();
  assert.ok(policy && typeof policy === "object");
}

process.stdout.write("sandbox readonly passed\n");
