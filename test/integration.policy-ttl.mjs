import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ClawSandboxClient } from "../dist/index.js";
import { loadIntegrationConfig, parseEnvClay } from "./load-integration-config.mjs";

const DEFAULT_FETCH_TIMEOUT_MS = Number(process.env.CLAW_TEST_FETCH_TIMEOUT_MS ?? 20_000);
const EXPECTED_DEFAULT_TTL = Number(process.env.CLAW_TEST_DEFAULT_TTL ?? 86_400);
const EXPECTED_POLICY_TTL = Number(process.env.CLAW_TEST_POLICY_TTL ?? 6_400);

function loadEnvContext() {
  const cfg = loadIntegrationConfig();
  const fileEnv = cfg.hadEnvFile ? parseEnvClay(readFileSync(cfg.envPath, "utf8")) : {};
  return {
    ...cfg,
    uid: String(process.env.CLAY_UID ?? fileEnv.CLAY_UID ?? "").trim(),
    userID: String(process.env.CLAY_TEST_USER_ID ?? fileEnv.CLAY_TEST_USER_ID ?? "").trim(),
    userJWT: String(process.env.CLAY_TEST_USER_JWT ?? fileEnv.CLAY_TEST_USER_JWT ?? "").trim(),
    walletPin: String(process.env.CLAW_TEST_PIN ?? fileEnv.CLAW_TEST_PIN ?? "").trim(),
  };
}

const ctx = loadEnvContext();

function requireString(name, value) {
  assert.ok(value, `${name} is required`);
  return value;
}

function timeoutSignal(ms, existing) {
  const signal = AbortSignal.timeout(ms);
  if (!existing) return signal;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([existing, signal]);
  }
  return signal;
}

async function timedFetch(input, init = {}) {
  return fetch(input, { ...init, signal: timeoutSignal(DEFAULT_FETCH_TIMEOUT_MS, init.signal) });
}

function relayHeaders(jwt, extra = {}) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${jwt}`,
    ...extra,
  };
}

async function fetchJson(url, init = {}) {
  const response = await timedFetch(url, init);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  return { response, data, text };
}

function normalizeAddressList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object" && typeof item.address === "string") return item.address.trim();
      return "";
    })
    .filter(Boolean);
}

function normalizePolicyAddressItems(list, chain) {
  if (!Array.isArray(list)) return [];
  const wantedChain = String(chain ?? "").trim().toLowerCase();
  return list
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const address = typeof item.address === "string" ? item.address.trim() : "";
      if (!address) return "";
      const itemChain = typeof item.chain === "string" ? item.chain.trim().toLowerCase() : "";
      if (wantedChain && itemChain !== wantedChain) return "";
      return `${itemChain}|${address}`;
    })
    .filter(Boolean);
}

function sortStrings(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

async function getBackendPolicy() {
  const url = new URL("/policy", requireString("CLAY_RELAY_URL", ctx.relayUrl));
  url.searchParams.set("uid", requireString("CLAY_UID", ctx.uid));
  url.searchParams.set("user_id", requireString("CLAY_TEST_USER_ID", ctx.userID));
  const { response, data, text } = await fetchJson(url, {
    method: "GET",
    headers: relayHeaders(requireString("CLAY_TEST_USER_JWT", ctx.userJWT)),
  });
  assert.equal(response.status, 200, `backend policy fetch failed ${response.status}: ${text.slice(0, 400)}`);
  return data;
}

async function waitForBackendPolicyAddresses(expected, chain, label) {
  const wanted = sortStrings(expected);
  let last = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    last = await getBackendPolicy();
    const actual = sortStrings(normalizePolicyAddressItems(last?.whitelisted_addresses, chain)).map((item) => item.split("|", 2)[1]);
    if (actual.length === wanted.length && actual.every((value, index) => value === wanted[index])) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `${label} backend whitelist did not match ${JSON.stringify(wanted)}; last=${JSON.stringify(normalizePolicyAddressItems(last?.whitelisted_addresses, chain))}`,
  );
}

async function getPolicyChallenge() {
  const url = new URL("/policy/challenge", requireString("CLAY_RELAY_URL", ctx.relayUrl));
  url.searchParams.set("uid", requireString("CLAY_UID", ctx.uid));
  url.searchParams.set("user_id", requireString("CLAY_TEST_USER_ID", ctx.userID));
  const { response, data, text } = await fetchJson(url, {
    method: "GET",
    headers: relayHeaders(requireString("CLAY_TEST_USER_JWT", ctx.userJWT)),
  });
  assert.equal(response.status, 200, `policy challenge failed ${response.status}: ${text.slice(0, 400)}`);
  assert.ok(typeof data?.message === "string" && data.message.length > 0, "policy challenge message missing");
  return data;
}

async function commitPolicy(newPolicy, signature) {
  const { response, data, text } = await fetchJson(`${requireString("CLAY_RELAY_URL", ctx.relayUrl)}/policy/commit`, {
    method: "POST",
    headers: relayHeaders(requireString("CLAY_TEST_USER_JWT", ctx.userJWT), {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      user_id: requireString("CLAY_TEST_USER_ID", ctx.userID),
      uid: requireString("CLAY_UID", ctx.uid),
      signature,
      new_policy: newPolicy,
    }),
  });
  assert.equal(response.status, 200, `policy commit failed ${response.status}: ${text.slice(0, 400)}`);
  return data;
}

async function getPolicyStatus() {
  const url = new URL("/policy/status", requireString("CLAY_RELAY_URL", ctx.relayUrl));
  url.searchParams.set("uid", requireString("CLAY_UID", ctx.uid));
  url.searchParams.set("user_id", requireString("CLAY_TEST_USER_ID", ctx.userID));
  const { response, data, text } = await fetchJson(url, {
    method: "GET",
    headers: relayHeaders(requireString("CLAY_TEST_USER_JWT", ctx.userJWT)),
  });
  assert.equal(response.status, 200, `policy status failed ${response.status}: ${text.slice(0, 400)}`);
  return data;
}

async function waitForPolicyStatus(targetStatus) {
  let last = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    last = await getPolicyStatus();
    if (String(last?.status ?? "").toLowerCase() === targetStatus) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`policy status did not become ${targetStatus}; last=${JSON.stringify(last)}`);
}

function buildCommittedPolicy(backendPolicy, localPolicy) {
  return {
    daily_transfer_limit_usd: Number(backendPolicy?.daily_transfer_limit_usd ?? 1000),
    per_tx_limit_usd: Number(backendPolicy?.per_tx_limit_usd ?? 100),
    allowed_tokens: Array.isArray(backendPolicy?.allowed_tokens) ? backendPolicy.allowed_tokens : [],
    blacklisted_addresses: normalizeAddressList(backendPolicy?.blacklisted_addresses),
    require_approval_above_usd: Number(backendPolicy?.require_approval_above_usd ?? 200),
    whitelisted_addresses: normalizeAddressList(backendPolicy?.whitelisted_addresses),
    pin_ttl_seconds: EXPECTED_POLICY_TTL,
    daily_max_tx_count: Number(
      backendPolicy?.daily_max_tx_count ?? localPolicy?.daily_max_tx_count ?? 1000,
    ),
    unpriced_asset_policy: String(
      backendPolicy?.unpriced_asset_policy ?? localPolicy?.unpriced_asset_policy ?? "block",
    ),
    block_high_risk_tokens: Boolean(
      backendPolicy?.block_high_risk_tokens ?? localPolicy?.block_high_risk_tokens ?? true,
    ),
    allow_blind_sign: Boolean(
      backendPolicy?.allow_blind_sign ?? localPolicy?.allow_blind_sign ?? false,
    ),
    strict_plain_text: Boolean(
      backendPolicy?.strict_plain_text ?? localPolicy?.strict_plain_text ?? true,
    ),
    keep_share2_resident: Boolean(
      backendPolicy?.keep_share2_resident ?? localPolicy?.keep_share2_resident ?? false,
    ),
    personal_sign_keyword_blacklist: Array.isArray(
      backendPolicy?.personal_sign_keyword_blacklist,
    )
      ? backendPolicy.personal_sign_keyword_blacklist
      : Array.isArray(localPolicy?.personal_sign_keyword_blacklist)
        ? localPolicy.personal_sign_keyword_blacklist
        : [],
  };
}

function ttlRemainingSecondsFromStatus(status) {
  if (Number.isFinite(Number(status?.ttl_remaining_seconds))) {
    return Number(status.ttl_remaining_seconds);
  }
  const expiry = String(status?.pin_residency_expires_at ?? "").trim();
  if (!expiry) return NaN;
  return Math.max(0, Math.floor((Date.parse(expiry) - Date.now()) / 1000));
}

async function main() {
  requireString("CLAY_SANDBOX_URL", ctx.baseUrl);
  requireString("CLAY_UID", ctx.uid);
  requireString("CLAY_RELAY_URL", ctx.relayUrl);
  requireString("CLAY_TEST_USER_ID", ctx.userID);
  requireString("CLAY_TEST_USER_JWT", ctx.userJWT);
  requireString("CLAW_TEST_PIN", ctx.walletPin);

  const sandbox = new ClawSandboxClient({
    uid: ctx.uid,
    sandboxUrl: ctx.baseUrl,
    sandboxToken: ctx.agentToken,
  });

  const lockedStatus = await sandbox.getStatus();
  assert.equal(
    lockedStatus.status,
    "provisioned_waiting_for_pin",
    `expected locked provisioned wallet before unlock, got ${lockedStatus.status}`,
  );

  const originalLocalPolicy = await sandbox.getLocalPolicy();
  assert.equal(
    Number(originalLocalPolicy?.pin_ttl_seconds),
    EXPECTED_DEFAULT_TTL,
    `expected default local ttl ${EXPECTED_DEFAULT_TTL}, got ${originalLocalPolicy?.pin_ttl_seconds}`,
  );

  const backendPolicy = await getBackendPolicy();
  const challenge = await getPolicyChallenge();
  const firstUnlock = await sandbox.unlockWallet({ pin: ctx.walletPin });
  assert.equal(firstUnlock.status, "ready", `initial unlock did not reach ready state: ${JSON.stringify(firstUnlock)}`);

  const signed = await sandbox.sign({
    chain: "ethereum",
    sign_mode: "personal_sign",
    to: "0x0000000000000000000000000000000000000000",
    amount_wei: "0",
    data: "0x",
    tx_payload_hex: Buffer.from(String(challenge.message), "utf8").toString("hex"),
  });
  assert.ok(signed.signature_hex, "sandbox did not return policy signature");

  const nextPolicy = buildCommittedPolicy(backendPolicy, originalLocalPolicy);
  const commitResult = await commitPolicy(nextPolicy, signed.signature_hex);
  assert.equal(commitResult.status, "policy_applied");
  assert.equal(commitResult.push_status, "pending", "remote-managed wallet should queue sandbox policy push");

  const appliedStatus = await waitForPolicyStatus("applied");
  assert.equal(appliedStatus.status, "applied");

  const wiped = await sandbox.wipeWallet();
  assert.equal(wiped.status, "memory_wiped");

  const relockedStatus = await sandbox.getStatus();
  assert.equal(
    relockedStatus.status,
    "provisioned_waiting_for_pin",
    `expected wallet to return to provisioned lock after wipe, got ${relockedStatus.status}`,
  );

  const unlocked = await sandbox.unlockWallet({ pin: ctx.walletPin });
  assert.equal(unlocked.status, "ready", `unlock did not reach ready state: ${JSON.stringify(unlocked)}`);

  const unlockedStatus = await sandbox.getStatus();
  assert.equal(
    Number(unlockedStatus?.policy?.pin_ttl_seconds),
    EXPECTED_POLICY_TTL,
    `unlock status policy ttl mismatch: ${unlockedStatus?.policy?.pin_ttl_seconds}`,
  );

  const ttlRemaining = ttlRemainingSecondsFromStatus(unlockedStatus);
  assert.ok(Number.isFinite(ttlRemaining), "unlock response did not expose TTL remaining");
  assert.ok(
    ttlRemaining <= EXPECTED_POLICY_TTL && ttlRemaining >= EXPECTED_POLICY_TTL - 180,
    `unlock ttl remaining expected near ${EXPECTED_POLICY_TTL}, got ${ttlRemaining}`,
  );

  const updatedBackendPolicy = await getBackendPolicy();
  assert.equal(
    Number(updatedBackendPolicy?.pin_ttl_seconds),
    EXPECTED_POLICY_TTL,
    `backend policy ttl mismatch: ${updatedBackendPolicy?.pin_ttl_seconds}`,
  );

  const updatedLocalPolicy = await sandbox.getLocalPolicy();
  assert.equal(
    Number(updatedLocalPolicy?.pin_ttl_seconds),
    EXPECTED_POLICY_TTL,
    `sandbox local policy ttl mismatch: ${updatedLocalPolicy?.pin_ttl_seconds}`,
  );

  const caseSensitiveOne = "AbCdEfGhijk12345";
  const caseSensitiveTwo = "aBcDeFgHijk12345";
  await sandbox.updateLocalPolicy({
    whitelist_to: [
      { address: caseSensitiveOne, chain: "solana", note: "primary" },
      { address: caseSensitiveTwo, chain: "solana", note: "secondary" },
    ],
  });
  await waitForBackendPolicyAddresses(
    [caseSensitiveOne, caseSensitiveTwo],
    "solana",
    "initial local sync",
  );

  await sandbox.updateLocalPolicy({
    whitelist_to: [{ address: caseSensitiveTwo, chain: "solana", note: "secondary" }],
  });
  await waitForBackendPolicyAddresses([caseSensitiveTwo], "solana", "prune local sync");

  process.stdout.write(
    `policy ttl integration passed (default=${EXPECTED_DEFAULT_TTL}, applied=${EXPECTED_POLICY_TTL}, remaining=${ttlRemaining})\n`,
  );
}

await main();
