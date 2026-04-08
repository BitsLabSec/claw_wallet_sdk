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

function normalizePolicyAddressItems(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const address = typeof item.address === "string" ? item.address.trim() : "";
      if (!address) return "";
      const itemChain = typeof item.chain === "string" ? item.chain.trim().toLowerCase() : "";
      return `${itemChain}|${address}`;
    })
    .filter(Boolean);
}

function sortStrings(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function normalizePolicySettingsFromBackend(policy) {
  return {
    max_amount_per_tx_usd: Number(policy?.per_tx_limit_usd ?? 0),
    daily_limit_usd: Number(policy?.daily_transfer_limit_usd ?? 0),
    daily_max_tx_count: Number(policy?.daily_max_tx_count ?? 0),
    blacklist_to: sortStrings(normalizePolicyAddressItems(policy?.blacklisted_addresses)),
    unpriced_asset_policy: String(policy?.unpriced_asset_policy ?? "").trim().toLowerCase(),
    allow_blind_sign: Boolean(policy?.allow_blind_sign),
    strict_plain_text: Boolean(policy?.strict_plain_text),
  };
}

function normalizePolicySettingsFromSandbox(policy) {
  return {
    max_amount_per_tx_usd: Number(policy?.max_amount_per_tx_usd ?? 0),
    daily_limit_usd: Number(policy?.daily_limit_usd ?? 0),
    daily_max_tx_count: Number(policy?.daily_max_tx_count ?? 0),
    blacklist_to: sortStrings(normalizePolicyAddressItems(policy?.blacklist_to)),
    unpriced_asset_policy: String(policy?.unpriced_asset_policy ?? "").trim().toLowerCase(),
    allow_blind_sign: Boolean(policy?.allow_blind_sign),
    strict_plain_text: Boolean(policy?.strict_plain_text),
  };
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

async function getBackendSandboxStatus() {
  const { response, data, text } = await fetchJson(
    `${requireString("CLAY_RELAY_URL", ctx.relayUrl)}/wallets/${encodeURIComponent(requireString("CLAY_UID", ctx.uid))}/sandbox/status`,
    {
      method: "GET",
      headers: relayHeaders(requireString("CLAY_TEST_USER_JWT", ctx.userJWT)),
    },
  );
  assert.equal(response.status, 200, `backend sandbox status failed ${response.status}: ${text.slice(0, 400)}`);
  return data;
}

async function updateLocalPolicyDetailed(patch) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const token = String(ctx.agentToken ?? "").trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const { response, data, text } = await fetchJson(`${requireString("CLAY_SANDBOX_URL", ctx.baseUrl)}/api/v1/policy/update`, {
    method: "POST",
    headers,
    body: JSON.stringify(patch),
  });
  assert.equal(response.status, 200, `local policy update failed ${response.status}: ${text.slice(0, 400)}`);
  return data;
}

async function waitForBackendPolicyAddressItems(expected, label) {
  const wanted = sortStrings(expected);
  let last = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    last = await getBackendPolicy();
    const actual = sortStrings(normalizePolicyAddressItems(last?.whitelisted_addresses));
    if (actual.length === wanted.length && actual.every((value, index) => value === wanted[index])) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `${label} backend whitelist did not match ${JSON.stringify(wanted)}; last=${JSON.stringify(normalizePolicyAddressItems(last?.whitelisted_addresses))}`,
  );
}

async function waitForBackendPolicySettings(expected, label) {
  let last = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    last = await getBackendPolicy();
    const actual = normalizePolicySettingsFromBackend(last);
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `${label} backend policy settings did not match ${JSON.stringify(expected)}; last=${JSON.stringify(normalizePolicySettingsFromBackend(last))}`,
  );
}

async function addPolicyAddresses(addresses, type = -1) {
  const { response, data, text } = await fetchJson(`${requireString("CLAY_RELAY_URL", ctx.relayUrl)}/policy/addresses/add`, {
    method: "POST",
    headers: relayHeaders(requireString("CLAY_TEST_USER_JWT", ctx.userJWT), {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      uid: requireString("CLAY_UID", ctx.uid),
      addresses: addresses.map((item) => ({
        ...item,
        type,
      })),
    }),
  });
  assert.equal(response.status, 200, `policy addresses add failed ${response.status}: ${text.slice(0, 400)}`);
  return data;
}

async function deletePolicyAddresses(addresses, type = -1) {
  const { response, data, text } = await fetchJson(`${requireString("CLAY_RELAY_URL", ctx.relayUrl)}/policy/addresses/del`, {
    method: "POST",
    headers: relayHeaders(requireString("CLAY_TEST_USER_JWT", ctx.userJWT), {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      uid: requireString("CLAY_UID", ctx.uid),
      type,
      addresses,
    }),
  });
  assert.equal(response.status, 200, `policy addresses delete failed ${response.status}: ${text.slice(0, 400)}`);
  return data;
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

async function waitForSandboxLocalWhitelist(expectedItems, label, sandbox) {
  const wanted = sortStrings(expectedItems);
  let last = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    last = await sandbox.getLocalPolicy();
    const actual = sortStrings(normalizePolicyAddressItems(last?.whitelist_to));
    if (actual.length === wanted.length && actual.every((value, index) => value === wanted[index])) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `${label} sandbox local whitelist did not match ${JSON.stringify(wanted)}; last=${JSON.stringify(normalizePolicyAddressItems(last?.whitelist_to))}`,
  );
}

async function waitForSandboxLocalPolicySettings(expected, label, sandbox) {
  let last = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    last = await sandbox.getLocalPolicy();
    const actual = normalizePolicySettingsFromSandbox(last);
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `${label} sandbox local policy settings did not match ${JSON.stringify(expected)}; last=${JSON.stringify(normalizePolicySettingsFromSandbox(last))}`,
  );
}

async function assertSandboxLocalPolicySettingsStay(expected, label, sandbox, durationMs = 16_000, stepMs = 4_000) {
  const samples = [];
  const startedAt = Date.now();
  while (Date.now() - startedAt <= durationMs) {
    const policy = await sandbox.getLocalPolicy();
    const actual = normalizePolicySettingsFromSandbox(policy);
    samples.push({
      atMs: Date.now() - startedAt,
      ...actual,
    });
    assert.deepEqual(
      actual,
      expected,
      `${label} sandbox local policy drifted: samples=${JSON.stringify(samples)}`,
    );
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return samples;
}

function buildCommittedPolicy(backendPolicy, localPolicy) {
  return {
    daily_transfer_limit_usd: 2468,
    per_tx_limit_usd: 135,
    allowed_tokens: Array.isArray(backendPolicy?.allowed_tokens) ? backendPolicy.allowed_tokens : [],
    blacklisted_addresses: normalizeAddressList(backendPolicy?.blacklisted_addresses),
    require_approval_above_usd: Number(backendPolicy?.require_approval_above_usd ?? 200),
    whitelisted_addresses: normalizeAddressList(backendPolicy?.whitelisted_addresses),
    pin_ttl_seconds: EXPECTED_POLICY_TTL,
    daily_max_tx_count: 17,
    unpriced_asset_policy: "allow",
    block_high_risk_tokens: Boolean(
      backendPolicy?.block_high_risk_tokens ?? localPolicy?.block_high_risk_tokens ?? true,
    ),
    allow_blind_sign: true,
    strict_plain_text: false,
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

function normalizeCommittedPolicySettings(policy) {
  return {
    max_amount_per_tx_usd: Number(policy?.per_tx_limit_usd ?? 0),
    daily_limit_usd: Number(policy?.daily_transfer_limit_usd ?? 0),
    daily_max_tx_count: Number(policy?.daily_max_tx_count ?? 0),
    unpriced_asset_policy: String(policy?.unpriced_asset_policy ?? "").trim().toLowerCase(),
    allow_blind_sign: Boolean(policy?.allow_blind_sign),
    strict_plain_text: Boolean(policy?.strict_plain_text),
    pin_ttl_seconds: Number(policy?.pin_ttl_seconds ?? 0),
  };
}

async function assertBackendPolicySettingsStay(expected, label, durationMs = 16_000, stepMs = 4_000) {
  const samples = [];
  const startedAt = Date.now();
  while (Date.now() - startedAt <= durationMs) {
    const policy = await getBackendPolicy();
    const actual = normalizeCommittedPolicySettings(policy);
    samples.push({
      atMs: Date.now() - startedAt,
      ...actual,
    });
    assert.deepEqual(
      actual,
      expected,
      `${label} backend policy drifted: samples=${JSON.stringify(samples)}`,
    );
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return samples;
}

async function assertBackendTTLDoesNotGrow(label, durationMs = 26_000, stepMs = 4_000) {
  process.stdout.write(`[ttl-check] waiting for backend active ttl: ${label}\n`);
  let firstActive = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = await getBackendSandboxStatus();
    const ttl = ttlRemainingSecondsFromStatus(status);
    process.stdout.write(
      `[ttl-check] pre-sample attempt=${attempt + 1} status=${String(status?.status ?? "")} fresh=${Boolean(status?.fresh)} ttl=${Number.isFinite(ttl) ? ttl : "n/a"}\n`,
    );
    if (String(status?.status ?? "").toLowerCase() === "active" && Number.isFinite(ttl) && ttl > 0) {
      firstActive = {
        atMs: 0,
        ttl,
        status: String(status?.status ?? ""),
        fresh: Boolean(status?.fresh),
      };
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.ok(firstActive, `${label} backend sandbox status never became active with a positive TTL`);

  const samples = [];
  const startedAt = Date.now();
  samples.push(firstActive);
  process.stdout.write(`[ttl-check] baseline ttl=${firstActive.ttl}\n`);
  while (Date.now() - startedAt <= durationMs) {
    const status = await getBackendSandboxStatus();
    const ttl = ttlRemainingSecondsFromStatus(status);
    assert.ok(Number.isFinite(ttl), `${label} backend sandbox status did not expose ttl_remaining_seconds`);
    assert.equal(String(status?.status ?? "").toLowerCase(), "active", `${label} backend sandbox status regressed from active: ${JSON.stringify(status)}`);
    const sample = {
      atMs: Date.now() - startedAt,
      ttl,
      status: String(status?.status ?? ""),
      fresh: Boolean(status?.fresh),
    };
    samples.push(sample);
    process.stdout.write(`[ttl-check] sample at=${sample.atMs}ms ttl=${sample.ttl}\n`);
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }

  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1];
    const next = samples[i];
    const growth = next.ttl - prev.ttl;
    assert.ok(
      growth <= 2,
      `${label} backend TTL grew unexpectedly: samples=${JSON.stringify(samples)}`,
    );
  }

  return samples;
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
  const expectedCommittedSettings = normalizeCommittedPolicySettings(nextPolicy);
  const commitResult = await commitPolicy(nextPolicy, signed.signature_hex);
  assert.equal(commitResult.status, "policy_applied");
  assert.equal(commitResult.push_status, "pending", "remote-managed wallet should queue sandbox policy push");
  const backendCommitStableSamples = await assertBackendPolicySettingsStay(
    expectedCommittedSettings,
    "post-commit pending policy",
  );

  const appliedStatus = await waitForPolicyStatus("applied");
  assert.equal(appliedStatus.status, "applied");
  const backendAppliedStableSamples = await assertBackendPolicySettingsStay(
    expectedCommittedSettings,
    "post-apply backend policy",
  );
  const appliedBackendPolicy = await getBackendPolicy();
  const expectedCommittedSandboxSettings = {
    max_amount_per_tx_usd: expectedCommittedSettings.max_amount_per_tx_usd,
    daily_limit_usd: expectedCommittedSettings.daily_limit_usd,
    daily_max_tx_count: expectedCommittedSettings.daily_max_tx_count,
    blacklist_to: sortStrings(normalizePolicyAddressItems(appliedBackendPolicy?.blacklisted_addresses)),
    unpriced_asset_policy: expectedCommittedSettings.unpriced_asset_policy,
    allow_blind_sign: expectedCommittedSettings.allow_blind_sign,
    strict_plain_text: expectedCommittedSettings.strict_plain_text,
  };
  await waitForSandboxLocalPolicySettings(
    expectedCommittedSandboxSettings,
    "sandbox apply committed backend policy settings before wipe",
    sandbox,
  );
  const sandboxAppliedStableSamples = await assertSandboxLocalPolicySettingsStay(
    expectedCommittedSandboxSettings,
    "post-apply sandbox committed policy",
    sandbox,
  );

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
  const ttlMonotonicSamples = await assertBackendTTLDoesNotGrow("post-unlock ttl");

  const updatedBackendPolicy = await getBackendPolicy();
  assert.deepEqual(
    normalizeCommittedPolicySettings(updatedBackendPolicy),
    expectedCommittedSettings,
    `backend committed policy mismatch: ${JSON.stringify(normalizeCommittedPolicySettings(updatedBackendPolicy))}`,
  );

  const updatedLocalPolicy = await sandbox.getLocalPolicy();
  assert.equal(
    Number(updatedLocalPolicy?.pin_ttl_seconds),
    EXPECTED_POLICY_TTL,
    `sandbox local policy ttl mismatch: ${updatedLocalPolicy?.pin_ttl_seconds}`,
  );
  await waitForSandboxLocalPolicySettings(
    {
      ...expectedCommittedSandboxSettings,
      blacklist_to: sortStrings(normalizePolicyAddressItems(updatedBackendPolicy?.blacklisted_addresses)),
    },
    "sandbox apply committed backend policy settings",
    sandbox,
  );

  const baselineWhitelist = sortStrings(normalizePolicyAddressItems(updatedBackendPolicy?.whitelisted_addresses));
  const localBaselineWhitelist = sortStrings(normalizePolicyAddressItems(updatedLocalPolicy?.whitelist_to));
  assert.deepEqual(
    localBaselineWhitelist,
    baselineWhitelist,
    "sandbox local whitelist should match backend baseline before address mutations",
  );

  await assert.rejects(
    sandbox.updateLocalPolicy({
      whitelist_to: [{ address: "0x1111111111111111111111111111111111111111", chain: "ethereum", note: "should-fail" }],
    }),
    /whitelist_to is managed by backend policy sync/i,
    "sandbox local whitelist writes should be rejected",
  );

  const afterRejectedWhitelistPolicy = await getBackendPolicy();
  assert.deepEqual(
    sortStrings(normalizePolicyAddressItems(afterRejectedWhitelistPolicy?.whitelisted_addresses)),
    baselineWhitelist,
    "rejected sandbox whitelist write should not change backend whitelist",
  );
  const afterRejectedLocalPolicy = await sandbox.getLocalPolicy();
  assert.deepEqual(
    sortStrings(normalizePolicyAddressItems(afterRejectedLocalPolicy?.whitelist_to)),
    localBaselineWhitelist,
    "rejected sandbox whitelist write should not change local whitelist",
  );

  await assert.rejects(
    sandbox.updateLocalPolicy({
      daily_limit_usd: 10001,
    }),
    /daily_limit_usd must be between 0 and 10000/i,
    "sandbox local policy limits should enforce max daily limit",
  );

  const localBlacklistEntry = {
    address: `0x${String(ctx.uid).padEnd(40, "b").slice(0, 40)}`,
    chain: "ethereum",
    note: "local-blacklist",
  };
  const localPolicyPatch = {
    max_amount_per_tx_usd: 321,
    daily_limit_usd: 4321,
    daily_max_tx_count: 9,
    blacklist_to: [localBlacklistEntry],
    unpriced_asset_policy: "allow",
    allow_blind_sign: true,
    strict_plain_text: false,
  };
  const expectedLocalPolicySettings = {
    max_amount_per_tx_usd: 321,
    daily_limit_usd: 4321,
    daily_max_tx_count: 9,
    blacklist_to: sortStrings([`ethereum|${localBlacklistEntry.address}`]),
    unpriced_asset_policy: "allow",
    allow_blind_sign: true,
    strict_plain_text: false,
  };

  const updatedLocalPolicyResponse = await updateLocalPolicyDetailed(localPolicyPatch);
  process.stdout.write(`[local-policy-sync] ${JSON.stringify(updatedLocalPolicyResponse?.sync_result ?? null)}\n`);
  const updatedFromSandbox = updatedLocalPolicyResponse?.policy ?? updatedLocalPolicyResponse;
  assert.deepEqual(
    normalizePolicySettingsFromSandbox(updatedFromSandbox),
    expectedLocalPolicySettings,
    "sandbox local policy patch should apply immediately",
  );

  await waitForBackendPolicySettings(expectedLocalPolicySettings, "backend sync allowed local policy fields");
  await waitForSandboxLocalPolicySettings(expectedLocalPolicySettings, "sandbox retain allowed local policy fields", sandbox);

  const sharedCrossChainAddress = `0x${String(ctx.uid).padEnd(40, "1").slice(0, 40)}`;
  const ethereumEntry = { chain: "ethereum", wallet_address: sharedCrossChainAddress, note: "eth-entry" };
  const baseEntry = { chain: "base", wallet_address: sharedCrossChainAddress, note: "base-entry" };

  await addPolicyAddresses([ethereumEntry, baseEntry], -1);
  await waitForPolicyStatus("applied");
  const expectedAddedWhitelist = sortStrings([
    ...baselineWhitelist,
    `ethereum|${sharedCrossChainAddress}`,
    `base|${sharedCrossChainAddress}`,
  ]);
  await waitForBackendPolicyAddressItems(expectedAddedWhitelist, "backend add cross-chain whitelist");
  await waitForSandboxLocalWhitelist(expectedAddedWhitelist, "sandbox apply cross-chain whitelist", sandbox);

  await deletePolicyAddresses([{ chain: "ethereum", wallet_address: sharedCrossChainAddress }], -1);
  await waitForPolicyStatus("applied");
  const expectedAfterDelete = sortStrings([
    ...baselineWhitelist,
    `base|${sharedCrossChainAddress}`,
  ]);
  await waitForBackendPolicyAddressItems(expectedAfterDelete, "backend delete single-chain whitelist");
  await waitForSandboxLocalWhitelist(expectedAfterDelete, "sandbox sync single-chain whitelist delete", sandbox);

  await deletePolicyAddresses([{ chain: "base", wallet_address: sharedCrossChainAddress }], -1);
  await waitForPolicyStatus("applied");
  await waitForBackendPolicyAddressItems(baselineWhitelist, "backend cleanup whitelist");
  await waitForSandboxLocalWhitelist(localBaselineWhitelist, "sandbox cleanup whitelist", sandbox);

  process.stdout.write(
    `policy e2e integration passed (default=${EXPECTED_DEFAULT_TTL}, applied=${EXPECTED_POLICY_TTL}, remaining=${ttlRemaining}, cross_chain_delete_ok=true, local_whitelist_rejected=true, local_policy_sync_ok=true, local_policy_limits_enforced=true, ttl_monotonic_samples=${ttlMonotonicSamples.length}, backend_commit_stable_samples=${backendCommitStableSamples.length}, backend_applied_stable_samples=${backendAppliedStableSamples.length}, sandbox_applied_stable_samples=${sandboxAppliedStableSamples.length})\n`,
  );
}

await main();
