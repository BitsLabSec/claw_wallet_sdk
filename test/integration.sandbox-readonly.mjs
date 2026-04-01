/**
 * Read-mostly Sandbox API + ClawSandboxClient helpers.
 * Does not import viem/ethers/solana/sui.
 */
import assert from "node:assert/strict";

import { ClawSandboxClient, createClawWalletClient } from "../dist/index.js";
import { loadIntegrationConfig } from "./load-integration-config.mjs";

const cfg = loadIntegrationConfig();
const ENABLE_SLOW_READS = /^(1|true|yes)$/i.test(process.env.CLAW_ENABLE_SLOW_READS ?? "");
const FETCH_TIMEOUT_MS = Number(process.env.CLAW_TEST_FETCH_TIMEOUT_MS ?? "20000");

function timeoutSignal(ms, existing) {
  const signal = AbortSignal.timeout(ms);
  if (!existing) return signal;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([existing, signal]);
  }
  return signal;
}

async function timedFetch(input, init = {}) {
  const signal = timeoutSignal(FETCH_TIMEOUT_MS, init.signal);
  return fetch(input, { ...init, signal });
}

if (!cfg.agentToken) {
  process.stdout.write("sandbox readonly skipped: missing CLAY_AGENT_TOKEN / AGENT_TOKEN\n");
  process.exit(0);
}

const client = createClawWalletClient({
  baseUrl: cfg.baseUrl,
  agentToken: cfg.agentToken,
  fetch: timedFetch,
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
  fetch: timedFetch,
});

const st = await sandbox.getStatus();
assert.ok(st && (typeof st.status === "string" || st.gateway_status));

if (ENABLE_SLOW_READS) {
  const assets = await sandbox.getAssets();
  assert.equal(typeof assets, "object");
  assert.notEqual(assets, null);

  const history = await sandbox.getHistory({ limit: 3 });
  assert.ok(Array.isArray(history));
}

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
