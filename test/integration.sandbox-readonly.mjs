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
const SLOW_CHAIN_POLL_TIMEOUT_MS = Number(process.env.CLAW_SLOW_CHAIN_POLL_TIMEOUT_MS ?? "45000");
const CHAIN_REFRESH_TIMEOUT_MS = Number(process.env.CLAW_CHAIN_REFRESH_TIMEOUT_MS ?? "180000");

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

async function timedBlockingFetch(input, init = {}) {
  const signal = timeoutSignal(CHAIN_REFRESH_TIMEOUT_MS, init.signal);
  return fetch(input, { ...init, signal });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function evmAddressForChain(status, chain) {
  const normalized = String(chain ?? "").trim().toLowerCase();
  return String(
    status?.addresses?.[normalized] ??
      status?.addresses?.ethereum ??
      status?.address ??
      "",
  ).trim();
}

function assertMonadAddressPresent(status) {
  const ethereum = evmAddressForChain(status, "ethereum").toLowerCase();
  const monad = evmAddressForChain(status, "monad").toLowerCase();
  assert.ok(ethereum.startsWith("0x"), "wallet/status missing ethereum address");
  assert.equal(monad, ethereum, "wallet/status should expose monad address matching ethereum");
}

function snapshotKeyForChain(status, chain) {
  const address = evmAddressForChain(status, chain);
  if (!address) {
    throw new Error(`missing address for slow chain ${chain}`);
  }
  return `${String(chain).trim().toLowerCase()}:${address}`;
}

function snapshotEntry(snapshot, key) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const entry = snapshot[key];
  return entry && typeof entry === "object" ? entry : null;
}

function snapshotUpdatedAt(snapshot, key) {
  const value = snapshotEntry(snapshot, key)?.updated_at;
  if (!value) return 0;
  const ts = Date.parse(String(value));
  return Number.isFinite(ts) ? ts : 0;
}

function snapshotAssetCount(snapshot, key) {
  const assets = snapshotEntry(snapshot, key)?.assets;
  return Array.isArray(assets) ? assets.length : 0;
}

async function waitForSlowChainCacheAdvance(sandbox, key, previousUpdatedAt) {
  const deadline = Date.now() + SLOW_CHAIN_POLL_TIMEOUT_MS;
  let lastSnapshot = null;
  while (Date.now() < deadline) {
    lastSnapshot = await sandbox.getAssets();
    const currentUpdatedAt = snapshotUpdatedAt(lastSnapshot, key);
    if (currentUpdatedAt > previousUpdatedAt || (previousUpdatedAt === 0 && currentUpdatedAt > 0)) {
      return {
        advanced: true,
        snapshot: lastSnapshot,
      };
    }
    await sleep(2000);
  }
  return {
    advanced: false,
    snapshot: lastSnapshot,
  };
}

async function assertSlowChainRefreshBehavior(sandbox, status, chain) {
  const key = snapshotKeyForChain(status, chain);
  const before = await sandbox.getAssets();
  const beforeUpdatedAt = snapshotUpdatedAt(before, key);
  const beforeAssets = snapshotAssetCount(before, key);

  const startedAt = Date.now();
  const [first, second, third] = await Promise.all([
    sandbox.refreshAndGetAssets(),
    sandbox.refreshAndGetAssets(),
    sandbox.refreshAndGetAssets(),
  ]);
  const triggerElapsed = Date.now() - startedAt;

  for (const snapshot of [first, second, third]) {
    assert.equal(typeof snapshot, "object");
    assert.notEqual(snapshot, null);
  }
  assert.ok(
    triggerElapsed < FETCH_TIMEOUT_MS * 2,
    `${chain} refreshAndGetAssets cluster took too long: ${triggerElapsed}ms`,
  );

  const waited = await waitForSlowChainCacheAdvance(sandbox, key, beforeUpdatedAt);
  const afterUpdatedAt = snapshotUpdatedAt(waited.snapshot, key);
  const afterAssets = snapshotAssetCount(waited.snapshot, key);
  process.stdout.write(
    `[slow-chain] ${chain} key=${key} trigger_ms=${triggerElapsed} before_updated_at=${beforeUpdatedAt || 0} after_updated_at=${afterUpdatedAt || 0} before_assets=${beforeAssets} after_assets=${afterAssets} advanced=${waited.advanced}\n`,
  );
}

async function benchmarkBlockingChainRefresh(sandbox, chain) {
  const firstStartedAt = Date.now();
  const first = await sandbox.refreshChain(chain);
  const firstMs = Date.now() - firstStartedAt;

  const secondStartedAt = Date.now();
  const second = await sandbox.refreshChain(chain);
  const secondMs = Date.now() - secondStartedAt;

  const firstStatus = String(first?.status ?? "");
  const secondStatus = String(second?.status ?? "");
  assert.ok(firstStatus === "refresh_completed" || firstStatus === "refresh_waited_existing");
  assert.ok(secondStatus === "refresh_completed" || secondStatus === "refresh_waited_existing");

  process.stdout.write(
    `[chain-refresh] ${chain} first_ms=${firstMs} first_status=${firstStatus} second_ms=${secondMs} second_status=${secondStatus}\n`,
  );
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
assertMonadAddressPresent(data);
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
const blockingSandbox = new ClawSandboxClient({
  uid,
  sandboxUrl: cfg.baseUrl,
  sandboxToken: cfg.agentToken,
  fetch: timedBlockingFetch,
});

const st = await sandbox.getStatus();
assert.ok(st && (typeof st.status === "string" || st.gateway_status));
assert.ok(st && typeof st.asset_refresh_state === "object");
assertMonadAddressPresent(st);

if (ENABLE_SLOW_READS) {
  const assets = await sandbox.getAssets();
  assert.equal(typeof assets, "object");
  assert.notEqual(assets, null);

  const history = await sandbox.getHistory({ limit: 3 });
  assert.ok(Array.isArray(history));

  await assertSlowChainRefreshBehavior(sandbox, st, "0g");
  await assertSlowChainRefreshBehavior(sandbox, st, "monad");
  await benchmarkBlockingChainRefresh(blockingSandbox, "0g");
  await benchmarkBlockingChainRefresh(blockingSandbox, "monad");
}

const policyProbe = await client.GET("/api/v1/policy/local", {});
assert.ok(
  policyProbe.response.status === 200 || policyProbe.response.status === 404,
  `unexpected policy status ${policyProbe.response.status}`,
);

const price = await client.GET("/api/v1/price/cache", {});
assert.equal(price.response.status, 200);
assert.ok(price.data !== undefined);
const requiredNativePriceKeys = [
  "native:ethereum",
  "native:solana",
  "native:sui",
  "native:bitcoin",
  "native:monad",
];
const priceMap = price.data?.prices;
if (priceMap && typeof priceMap === "object") {
  for (const key of requiredNativePriceKeys) {
    const value = Number(priceMap[key] ?? 0);
    assert.ok(value > 0, `${key} missing from /api/v1/price/cache`);
  }
}

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
