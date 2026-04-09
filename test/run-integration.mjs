import assert from "node:assert/strict";
import { createHmac, randomUUID, webcrypto } from "node:crypto";
import { blake2b } from "@noble/hashes/blake2b";

import {
  buildPersonalSignBody,
  ClawSandboxClient,
  bytesToHex,
  hexToBytes,
  createClawWalletClient,
} from "../dist/index.js";
import {
  createClawSandboxPublicClient,
  createClawAccountFromSandbox,
  recoverEvmPersonalSignAddress,
} from "../dist/viem.js";
import {
  ClawEthersSigner,
  createClawSandboxJsonRpcProvider,
  recoverAddressFromPersonalSignEthers,
} from "../dist/ethers.js";
import { ClawSolanaSigner } from "../dist/solana.js";
import { ClawSuiSigner } from "../dist/sui.js";
import {
  Signature,
  Transaction as EthersTransaction,
  recoverAddress as recoverEvmAddress,
  verifyTypedData as verifyTypedDataEthers,
} from "ethers";
import { recoverTypedDataAddress } from "viem";
import { parseSerializedSignature } from "@mysten/sui/cryptography";
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import { SystemProgram, Transaction } from "@solana/web3.js";
import { loadIntegrationConfig } from "./load-integration-config.mjs";
import {
  canUseLocalReactivation,
  isProvisionedWalletStatus,
} from "./lifecycle-state.mjs";

const FUNDS_LIKE =
  /insufficient|underflow|balance|funds|fund|gas|fee|intrinsic|overshot|exceed|need more|too low|cannot afford|execution reverted|revert|nonce too|replacement/i;

const SANDBOX_GATE =
  /confirmation|first outbound|requires confirm|policy|whitelist|blacklist|share2|gate|relay/i;

const TRANSIENT_RPC_FAILURE =
  /too many connections|rpc .* failed|eth_chainId failed|temporar|bad gateway|timeout/i;
const REFRESH_TIMEOUT_FAILURE =
  /asset refresh timed out|usage refresh timed out|retry later/i;

const SUPPORTED_EVM_CHAINS = ["ethereum", "0g", "monad", "arbitrum", "base", "bsc"];
const SUPPORTED_NON_EVM_CHAINS = ["solana", "sui", "bitcoin"];
const DEFAULT_BACKEND_JWT_SECRET = process.env.CLAY_BACKEND_JWT_SECRET?.trim() || "claw-wallet-default-secret";
const ETHEREUM_USDC = "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SUI_NATIVE_COIN = "0x2::sui::SUI";
const SUI_CETUS_COIN = "0x6864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS";

function numberFromEnv(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const FETCH_TIMEOUT_MS = numberFromEnv("CLAW_TEST_FETCH_TIMEOUT_MS", 20_000);
const STEP_TIMEOUT_MS = numberFromEnv("CLAW_TEST_STEP_TIMEOUT_MS", 45_000);
let sandbox = null;

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

async function assertBackendRelayHealthy(relayUrl) {
  const url = String(relayUrl || "").trim();
  if (!url) {
    throw new Error(
      "CLAY_RELAY_URL is required for wallet lifecycle checks; start the local backend first or use scripts/run_fresh_sdk_integration.py",
    );
  }
  try {
    const res = await timedFetch(`${url.replace(/\/+$/, "")}/health`, {});
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`backend relay health check failed: HTTP ${res.status} ${text}`.trim());
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`backend relay health check failed for ${url}: ${msg}`);
  }
}

function errorText(error) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function assertRpcProxyBlockNumber(chainKey, kind) {
  if (kind === "viem") {
    const n = await withRetry(async () => {
      const publicClient = createClawSandboxPublicClient({
        baseUrl: cfg.baseUrl,
        agentToken: cfg.agentToken,
        chainKey,
      });
      return publicClient.getBlockNumber();
    });
    assert.ok(typeof n === "bigint");
    assert.ok(n > 0n);
    return;
  }

  const n = await withRetry(async () => {
    const provider = createClawSandboxJsonRpcProvider({
      baseUrl: cfg.baseUrl,
      agentToken: cfg.agentToken,
      chainKey,
    });
    return provider.getBlockNumber();
  });
  assert.ok(Number.isFinite(n));
  assert.ok(n > 0);
}

async function assertRpcProxyBalance(chainKey, address, kind) {
  if (kind === "viem") {
    const balance = await withRetry(async () => {
      const publicClient = createClawSandboxPublicClient({
        baseUrl: cfg.baseUrl,
        agentToken: cfg.agentToken,
        chainKey,
      });
      return publicClient.getBalance({ address });
    });
    assert.ok(typeof balance === "bigint");
    assert.ok(balance >= 0n);
    return;
  }

  const balance = await withRetry(async () => {
    const provider = createClawSandboxJsonRpcProvider({
      baseUrl: cfg.baseUrl,
      agentToken: cfg.agentToken,
      chainKey,
    });
    return provider.getBalance(address);
  });
  assert.ok(typeof balance === "bigint");
  assert.ok(balance >= 0n);
}

async function fetchEvmChainId(chainKey) {
  const provider = createClawSandboxJsonRpcProvider({
    baseUrl: cfg.baseUrl,
    agentToken: cfg.agentToken,
    chainKey,
  });
  const raw = await withRetry(() => provider.send("eth_chainId", []));
  const chainId = Number.parseInt(String(raw), 16);
  assert.ok(Number.isFinite(chainId) && chainId > 0, `${chainKey} eth_chainId invalid: ${raw}`);
  return chainId;
}

async function assertEvmPersonalSignForChain(client, status, uid, chainKey) {
  const expectedAddress = String(
    status?.addresses?.[chainKey] ??
      status?.addresses?.ethereum ??
      status?.address ??
      "",
  ).trim().toLowerCase();
  assert.ok(expectedAddress.startsWith("0x"), `${chainKey} address missing in wallet status`);

  const message = `claw_wallet_sdk ${chainKey} personal_sign ${Date.now()}`;
  const body = buildPersonalSignBody({
    chain: chainKey,
    uid,
    message,
  });

  const { data, error, response } = await client.POST("/api/v1/tx/sign", {
    body,
    parseAs: "text",
  });
  const signRaw =
    typeof data === "string"
      ? data
      : typeof error === "string"
        ? error
        : errorText(error);

  assert.equal(
    response.status,
    200,
    `${chainKey} personal_sign failed ${response.status}: ${String(signRaw).slice(0, 400)}`,
  );

  const signed = JSON.parse(signRaw);
  assert.ok(signed.signature_hex, `${chainKey} signature_hex missing`);
  assert.ok(signed.from, `${chainKey} from missing`);

  const recoveredViem = (
    await recoverEvmPersonalSignAddress(message, signed.signature_hex)
  ).toLowerCase();
  const recoveredEthers = recoverAddressFromPersonalSignEthers(
    message,
    signed.signature_hex,
  ).toLowerCase();

  assert.equal(recoveredViem, expectedAddress, `${chainKey} viem recovered wrong address`);
  assert.equal(recoveredEthers, expectedAddress, `${chainKey} ethers recovered wrong address`);
  assert.equal(String(signed.from).toLowerCase(), expectedAddress, `${chainKey} sandbox from mismatch`);
}

function evmExpectedAddressForChain(status, chainKey) {
  return String(
    status?.addresses?.[chainKey] ??
      status?.addresses?.ethereum ??
      status?.address ??
      "",
  ).trim().toLowerCase();
}

function assertMonadAddressPresent(status) {
  const ethereum = String(status?.addresses?.ethereum ?? status?.address ?? "").trim().toLowerCase();
  const monad = String(status?.addresses?.monad ?? "").trim().toLowerCase();
  assert.ok(ethereum.startsWith("0x"), "wallet/status missing ethereum address");
  assert.equal(monad, ethereum, "wallet/status should expose monad address matching ethereum");
}

async function assertEvmTransactionSignForChain(client, sandbox, status, uid, chainKey) {
  const expectedAddress = evmExpectedAddressForChain(status, chainKey);
  assert.ok(expectedAddress.startsWith("0x"), `${chainKey} address missing in wallet status`);

  const chainId = await fetchEvmChainId(chainKey);
  const unsigned = EthersTransaction.from({
    chainId,
    nonce: 0,
    gasLimit: 21000n,
    gasPrice: 1_000_000_000n,
    to: expectedAddress,
    value: 42n,
    data: "0x",
    type: 0,
  });

  const { data, error, response } = await client.POST("/api/v1/tx/sign", {
    body: {
      chain: chainKey,
      uid,
      sign_mode: "transaction",
      confirmed_by_user: true,
      to: expectedAddress,
      amount_wei: "42",
      data: "0x",
      tx_payload_hex: unsigned.unsignedSerialized,
    },
    parseAs: "text",
  });

  const raw =
    typeof data === "string"
      ? data
      : typeof error === "string"
        ? error
        : "";

  if (response.ok) {
    const signed = JSON.parse(raw);
    assert.ok(signed.signature_hex, `${chainKey} transaction signature missing`);
    assert.ok(signed.from, `${chainKey} transaction signer missing`);
    assert.equal(String(signed.from).toLowerCase(), expectedAddress, `${chainKey} transaction signer mismatch`);

    unsigned.signature = Signature.from(signed.signature_hex);
    const parsedSigned = EthersTransaction.from(unsigned.serialized);
    assert.equal(parsedSigned.from?.toLowerCase(), expectedAddress, `${chainKey} parsed from mismatch`);
    assert.equal(parsedSigned.to?.toLowerCase(), expectedAddress, `${chainKey} parsed to mismatch`);
    assert.equal(parsedSigned.value, 42n, `${chainKey} parsed value mismatch`);
    assert.equal(parsedSigned.chainId, BigInt(chainId), `${chainKey} parsed chainId mismatch`);
    return;
  }

  const text = raw.slice(0, 800);
  const acceptable =
    SANDBOX_GATE.test(text) ||
    TRANSIENT_RPC_FAILURE.test(text) ||
    REFRESH_TIMEOUT_FAILURE.test(text) ||
    /method not found|unsupported|history unavailable|failed to refresh|rpc/i.test(text) ||
    response.status === 409 ||
    response.status === 403 ||
    response.status === 400 ||
    response.status === 503;
  assert.ok(
    acceptable,
    `expected ${chainKey} tx/sign failure to be refresh/provider-like, got status=${response.status}: ${text}`,
  );
}

async function assertTransferSmokeForChain(client, status, uid, chainKey) {
  const expectedAddress = evmExpectedAddressForChain(status, chainKey);
  assert.ok(expectedAddress.startsWith("0x"), `${chainKey} address missing in wallet status`);

  const { data, error, response } = await client.POST("/api/v1/tx/transfer", {
    body: {
      chain: chainKey,
      uid,
      to: expectedAddress,
      amount_wei: "1",
    },
    parseAs: "text",
  });

  const transferRaw =
    typeof data === "string"
      ? data
      : typeof error === "string"
        ? error
        : "";

  if (response.ok) {
    assert.ok(transferRaw, `${chainKey} transfer 200 should include body`);
    const parsed = JSON.parse(transferRaw);
    if (parsed.chain) {
      assert.equal(String(parsed.chain).toLowerCase(), chainKey, `${chainKey} transfer response chain mismatch`);
    }
    return;
  }

  const text = transferRaw.slice(0, 800);
  const acceptable =
    FUNDS_LIKE.test(text) ||
    SANDBOX_GATE.test(text) ||
    TRANSIENT_RPC_FAILURE.test(text) ||
    REFRESH_TIMEOUT_FAILURE.test(text) ||
    response.status === 409 ||
    response.status === 403 ||
    response.status === 400 ||
    response.status === 503;
  assert.ok(
    acceptable,
    `expected ${chainKey} transfer failure to be funds/gate/refresh/provider-like, got status=${response.status}: ${text}`,
  );
}

async function assertProviderInferredEvmTransactionSignForChain(status, uid, chainKey) {
  const provider = createClawSandboxJsonRpcProvider({
    baseUrl: cfg.baseUrl,
    agentToken: cfg.agentToken,
    chainKey,
  });
  const signer = new ClawEthersSigner(
    {
      uid,
      sandboxUrl: cfg.baseUrl,
      sandboxToken: cfg.agentToken,
    },
    provider,
  );

  const expectedAddress = evmExpectedAddressForChain(status, chainKey);
  assert.ok(expectedAddress.startsWith("0x"), `${chainKey} address missing`);

  const network = await withRetry(() => provider.getNetwork());
  assert.ok(network.chainId > 0n, `${chainKey} provider returned invalid chainId`);

  const nonce = await withRetry(() => provider.getTransactionCount(expectedAddress, "pending"));
  const feeData = await withRetry(() => provider.getFeeData());
  const gasPrice = feeData.gasPrice ?? 50_000_000n;

  const signedSerialized = await signer.signTransaction({
    nonce,
    gasLimit: 21000n,
    gasPrice,
    to: expectedAddress,
    value: 1n,
    data: "0x",
    type: 0,
  });

  const parsedSigned = EthersTransaction.from(signedSerialized);
  assert.equal(parsedSigned.chainId, BigInt(network.chainId), `${chainKey} inferred chainId mismatch`);
  assert.equal(parsedSigned.from?.toLowerCase(), expectedAddress, `${chainKey} parsed from mismatch`);
  assert.equal(parsedSigned.to?.toLowerCase(), expectedAddress, `${chainKey} parsed to mismatch`);
}

function isRetryableNetworkError(error) {
  const text = String(error instanceof Error ? error.message : error ?? "");
  return /502|503|504|bad gateway|failed to detect network|timeout|temporar|upstream connect error|invalid json was received by the server|cannot parse json-rpc response|too many connections/i.test(text);
}

async function withRetry(fn, attempts = 3, delayMs = 1000) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i === attempts - 1 || !isRetryableNetworkError(error)) {
        throw error;
      }
      await sleep(delayMs);
    }
  }
  throw lastError;
}

async function assertSwapSmoke(client, path, body, validateSuccess) {
  const { data, error, response } = await client.POST(path, {
    body,
    parseAs: "text",
  });

  const raw =
    typeof data === "string"
      ? data
      : typeof error === "string"
        ? error
        : "";

  if (response.ok) {
    assert.ok(raw, `${path} 200 should include body`);
    const parsed = JSON.parse(raw);
    validateSuccess(parsed);
    return;
  }

  const text = raw.slice(0, 800);
  const acceptable =
    FUNDS_LIKE.test(text) ||
    SANDBOX_GATE.test(text) ||
    TRANSIENT_RPC_FAILURE.test(text) ||
    REFRESH_TIMEOUT_FAILURE.test(text) ||
    /jupiter|cetus|quote|swap_v3|find_routes|dryrun|unexpected signer set|allowed jupiter program|payer mismatch/i.test(text) ||
    response.status === 409 ||
    response.status === 403 ||
    response.status === 400 ||
    response.status === 503;
  assert.ok(
    acceptable,
    `expected swap failure to be funds/gate/refresh/provider-like, got status=${response.status}: ${text}`,
  );
}

async function runStep(name, fn) {
  process.stdout.write(`- ${name} ... `);
  const started = Date.now();
  let timer;
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`step timed out after ${STEP_TIMEOUT_MS}ms`));
        }, STEP_TIMEOUT_MS);
      }),
    ]);
    const elapsed = Date.now() - started;
    process.stdout.write(`ok (${elapsed}ms)\n`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function verifyEd25519Signature(publicKeyBytes, signature, payload) {
  const key = await webcrypto.subtle.importKey(
    "raw",
    publicKeyBytes,
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  return webcrypto.subtle.verify("Ed25519", key, signature, payload);
}

async function refreshWalletStatus(client) {
  const { data, error, response } = await client.GET("/api/v1/wallet/status", {});
  assert.equal(response.status, 200, `wallet/status failed: ${error ?? response.statusText}`);
  assert.ok(data, "expected wallet/status response body");
  return data;
}

function assertReadyStatus(status, context) {
  assert.equal(status?.status, "ready", `${context}: expected wallet to be ready`);
  assert.equal(status?.gateway_status, "active", `${context}: expected gateway_status=active`);
}

function authHeaders() {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (cfg.agentToken) {
    headers.Authorization = `Bearer ${cfg.agentToken}`;
  }
  return headers;
}

async function updateLocalPolicy(patch) {
  return sandbox.updateLocalPolicy(patch);
}

async function setOracleTestState(patch) {
  const response = await timedFetch(`${cfg.baseUrl}/api/v1/test/oracle/state`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(patch),
  });
  const text = await response.text();
  assert.equal(
    response.status,
    200,
    `oracle test state update failed ${response.status}: ${text.slice(0, 400)}`,
  );
  return text ? JSON.parse(text) : {};
}

function buildPolicyRestorePatch(policy) {
  return {
    max_amount_per_tx_usd: policy?.max_amount_per_tx_usd ?? 0,
    daily_limit_usd: policy?.daily_limit_usd ?? 0,
    daily_max_tx_count: policy?.daily_max_tx_count ?? 0,
    blacklist_to: Array.isArray(policy?.blacklist_to) ? policy.blacklist_to : [],
    unpriced_asset_policy: policy?.unpriced_asset_policy ?? "allow",
    allow_blind_sign: Boolean(policy?.allow_blind_sign),
    strict_plain_text: Boolean(policy?.strict_plain_text),
  };
}

async function fetchBindChallenge(uid) {
  assert.ok(cfg.relayUrl, "CLAY_RELAY_URL is required for bind integration coverage");
  const userID = randomUUID();
  const token = issueBackendTestJWT(userID);
  const url = new URL("/wallets/bind/challenge", cfg.relayUrl);
  url.searchParams.set("uid", uid);
  url.searchParams.set("user_id", userID);
  url.searchParams.set("mode", "manual");
  const response = await timedFetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (
    response.status === 409 &&
    String(parsed?.reason ?? "").trim() === "wallet_already_bound" &&
    String(parsed?.user_id ?? "").trim()
  ) {
    parsed.user_id = String(parsed.user_id).trim();
    parsed.jwt = issueBackendTestJWT(parsed.user_id);
    parsed.already_bound = true;
    return parsed;
  }
  assert.equal(
    response.status,
    200,
    `bind challenge failed ${response.status}: ${text.slice(0, 400)}`,
  );
  assert.ok(parsed.message_hash_hex, "bind challenge did not include message_hash_hex");
  parsed.user_id = userID;
  parsed.jwt = token;
  return parsed;
}

function relayAuthHeaders(relayAuth) {
  assert.ok(relayAuth?.jwt, "relay auth JWT is required");
  return {
    Accept: "application/json",
    Authorization: `Bearer ${relayAuth.jwt}`,
  };
}

async function fetchBackendPolicy(uid, relayAuth) {
  assert.ok(cfg.relayUrl, "CLAY_RELAY_URL is required for backend policy coverage");
  const url = new URL("/policy", cfg.relayUrl);
  url.searchParams.set("uid", uid);
  url.searchParams.set("user_id", relayAuth.userID);
  const response = await timedFetch(url, {
    method: "GET",
    headers: relayAuthHeaders(relayAuth),
  });
  const text = await response.text();
  assert.equal(response.status, 200, `backend policy fetch failed ${response.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

async function addBackendPolicyAddresses(uid, relayAuth, addresses) {
  assert.ok(cfg.relayUrl, "CLAY_RELAY_URL is required for backend policy coverage");
  const response = await timedFetch(`${cfg.relayUrl}/policy/addresses/add`, {
    method: "POST",
    headers: {
      ...relayAuthHeaders(relayAuth),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      uid,
      addresses,
    }),
  });
  const text = await response.text();
  assert.equal(
    response.status,
    200,
    `backend policy address add failed ${response.status}: ${text.slice(0, 400)}`,
  );
  return text ? JSON.parse(text) : {};
}

function randomHex(bytes) {
  return Buffer.from(webcrypto.getRandomValues(new Uint8Array(bytes))).toString("hex");
}

function policyHasAddress(list, chain, address) {
  const targetChain = String(chain ?? "").trim().toLowerCase();
  const targetAddress = String(address ?? "").trim().toLowerCase();
  return Array.isArray(list) && list.some((item) => {
    const itemChain = String(item?.chain ?? "").trim().toLowerCase();
    const itemAddress = String(item?.address ?? "").trim().toLowerCase();
    return itemChain === targetChain && itemAddress === targetAddress;
  });
}

async function waitForBackendPolicyAddress(uid, relayAuth, chain, address, fieldName) {
  let lastPolicy = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    lastPolicy = await fetchBackendPolicy(uid, relayAuth);
    if (policyHasAddress(lastPolicy?.[fieldName], chain, address)) {
      return lastPolicy;
    }
    await sleep(500);
  }
  throw new Error(
    `backend policy did not include ${fieldName} ${chain}:${address}; last=${JSON.stringify(lastPolicy)}`,
  );
}

async function waitForLocalPolicyAddress(chain, address, fieldName) {
  let lastPolicy = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    lastPolicy = await sandbox.getLocalPolicy();
    if (policyHasAddress(lastPolicy?.[fieldName], chain, address)) {
      return lastPolicy;
    }
    await sleep(500);
  }
  throw new Error(
    `local policy did not include ${fieldName} ${chain}:${address}; last=${JSON.stringify(lastPolicy)}`,
  );
}

function issueBackendTestJWT(userID) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: userID,
    user_id: userID,
    iat: now,
    exp: now + 7 * 24 * 60 * 60,
  };
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", DEFAULT_BACKEND_JWT_SECRET)
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

async function waitForRelayBound(client) {
  let lastStatus;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    lastStatus = await refreshWalletStatus(client);
    if (lastStatus?.relay_user_bound === true && String(lastStatus?.relay_binding_status) === "valid") {
      return lastStatus;
    }
    await sleep(500);
  }
  throw new Error(
    `wallet did not become relay-bound in time; last status=${JSON.stringify({
      relay_user_bound: lastStatus?.relay_user_bound,
      relay_binding_status: lastStatus?.relay_binding_status,
    })}`,
  );
}

function getNativeEthereumPrice(pricePayload) {
  const prices = pricePayload?.prices;
  const price = Number(prices?.["native:ethereum"] ?? 0);
  assert.ok(price > 0, "native:ethereum price missing from /api/v1/price/cache");
  return price;
}

function assertRequiredNativePrices(pricePayload, requiredChains) {
  const prices = pricePayload?.prices;
  assert.ok(prices && typeof prices === "object", "price cache should include prices object");

  for (const chainKey of requiredChains) {
    const key = `native:${chainKey}`;
    const price = Number(prices?.[key] ?? 0);
    assert.ok(price > 0, `${key} price missing from /api/v1/price/cache`);
  }
}

function weiForUsd(targetUsd, nativePriceUsd) {
  const wei = Math.floor((targetUsd / nativePriceUsd) * 1e18);
  assert.ok(wei > 0, "expected wei amount derived from USD target to be positive");
  return BigInt(wei);
}

async function signEthereumTransaction(signer, to, value) {
  const signedSerialized = await signer.signTransaction({
    chainId: 1,
    nonce: 0,
    gasLimit: 21000n,
    gasPrice: 1_000_000_000n,
    to,
    value,
    data: "0x",
    type: 0,
  });
  return EthersTransaction.from(signedSerialized);
}

const cfg = loadIntegrationConfig();

async function main() {
  await assertBackendRelayHealthy(cfg.relayUrl);
  const client = createClawWalletClient({
    baseUrl: cfg.baseUrl,
    agentToken: cfg.agentToken || undefined,
    fetch: timedFetch,
  });

  await runStep("GET /health", async () => {
    const { data, error, response } = await client.GET("/health", {});
    assert.equal(response.status, 200, `health failed: ${error ?? response.statusText}`);
    assert.ok(data, "expected JSON body");
    assert.equal(data.status, "ok");
  });

  const { data: initialStatus, response: statusResponse } = await client.GET("/api/v1/wallet/status", {});
  assert.equal(statusResponse.status, 200, "wallet/status required for integration runner");

  const statusUid = String(initialStatus?.uid ?? "").trim();
  assert.ok(statusUid, "wallet/status did not include uid");
  assertMonadAddressPresent(initialStatus);
  const envUid = String(process.env.CLAY_UID?.trim() || "").trim();
  if (envUid && envUid !== statusUid) {
    throw new Error(`CLAY_UID mismatch: env=${envUid} status=${statusUid}`);
  }
  const uid = statusUid;
  let currentStatus = initialStatus;
  let relayAuth = null;

  sandbox = new ClawSandboxClient({
    uid,
    sandboxUrl: cfg.baseUrl,
    sandboxToken: cfg.agentToken || "",
    fetch: timedFetch,
  });

  await runStep("GET /api/v1/wallet/status", async () => {
    const { data, error, response } = await client.GET("/api/v1/wallet/status", {});
    assert.equal(
      response.status,
      200,
      `wallet/status failed: ${error ?? response.statusText} (loaded env from ${cfg.hadEnvFile ? cfg.envPath : "env vars only"})`,
    );
    assert.ok(data, "expected JSON body");
    assert.ok("status" in data || "gateway_status" in data);
    assertMonadAddressPresent(data);
  });

  await runStep("reject wrong bearer", async () => {
    if (!cfg.agentToken) {
      return;
    }
    const wrongClient = createClawWalletClient({
      baseUrl: cfg.baseUrl,
      agentToken: "definitely-not-the-sandbox-token",
    });
    const { response } = await wrongClient.GET("/api/v1/wallet/status", {});
    assert.equal(response.status, 401);
  });

  await runStep("wallet lifecycle: reactivate branch", async () => {
    if (canUseLocalReactivation(currentStatus)) {
      const reactivated = await sandbox.reactivateWallet();
      assert.equal(reactivated.status, "ready");
      currentStatus = reactivated;
      return;
    }

    const { response, data, error } = await client.POST("/api/v1/wallet/reactivate", {
      parseAs: "text",
    });
    const text = typeof data === "string" ? data : typeof error === "string" ? error : "";
    if (response.status === 200) {
      const body = JSON.parse(text);
      assert.equal(body.status, "ready");
      currentStatus = body;
      return;
    }
    assert.equal(
      response.status,
      409,
      `expected reactivate to be unavailable or idempotently ready, got ${response.status}: ${text}`,
    );
  });

  await runStep("wallet lifecycle: unlock branch", async () => {
    const isProvisioned = isProvisionedWalletStatus(currentStatus);

    if (isProvisioned) {
      const testPin = process.env.CLAW_TEST_PIN?.trim();
      if (testPin) {
        const unlocked = await sandbox.unlockWallet({ pin: testPin });
        assert.equal(unlocked.status, "ready");
        currentStatus = unlocked;
        return;
      }

      const { response } = await client.POST("/api/v1/wallet/unlock", {
        body: { pin: "000000" },
        parseAs: "text",
      });
      assert.equal(response.status, 401, "expected wrong PIN rejection for provisioned wallet");
      return;
    }

    const { response, data, error } = await client.POST("/api/v1/wallet/unlock", {
      body: { pin: "000000" },
      parseAs: "text",
    });
    const text = typeof data === "string" ? data : typeof error === "string" ? error : "";
    assert.equal(
      response.status,
      409,
      `expected unlock to be unavailable for non-provisioned wallet, got ${response.status}: ${text}`,
    );
  });

  await runStep("wallet lifecycle: ready state", async () => {
    currentStatus = await refreshWalletStatus(client);
    assertReadyStatus(currentStatus, "post-lifecycle");
  });

  await runStep("oracle health + price cache smoke", async () => {
    currentStatus = await refreshWalletStatus(client);
    assert.equal(typeof currentStatus?.oracle_healthy, "boolean", "wallet/status should expose oracle_healthy");
    assert.equal(typeof currentStatus?.oracle_native, "boolean", "wallet/status should expose oracle_native");
    assert.equal(typeof currentStatus?.oracle_tokens, "boolean", "wallet/status should expose oracle_tokens");

    const priceProbe = await client.GET("/api/v1/price/cache", {});
    assert.equal(priceProbe.response.status, 200, "price cache endpoint should be available");
    assert.ok(priceProbe.data && typeof priceProbe.data === "object", "price cache should return JSON");

    if (currentStatus?.oracle_healthy) {
      assertRequiredNativePrices(priceProbe.data, ["ethereum", "solana", "sui", "bitcoin", "monad"]);
      const nativeEthereumPrice = getNativeEthereumPrice(priceProbe.data);
      assert.ok(nativeEthereumPrice > 0, "oracle healthy should expose native:ethereum price");
    }
  });

  await runStep("oracle unavailable risk control smoke", async () => {
    const originalPolicy = await sandbox.getLocalPolicy();
    const originalPriceProbe = await client.GET("/api/v1/price/cache", {});
    assert.equal(originalPriceProbe.response.status, 200, "price cache required for oracle fault smoke");
    const originalPrices =
      originalPriceProbe.data && typeof originalPriceProbe.data === "object"
        ? originalPriceProbe.data.prices ?? {}
        : {};
    const effectiveSpentUsd = Number(currentStatus?.today_effective_spent_usd ?? 0);

    const recipient = "0x000000000000000000000000000000000000dEaD";
    const provider = createClawSandboxJsonRpcProvider({
      baseUrl: cfg.baseUrl,
      agentToken: cfg.agentToken,
      chainKey: "ethereum",
    });
    const signer = new ClawEthersSigner(
      {
        uid,
        sandboxUrl: cfg.baseUrl,
        sandboxToken: cfg.agentToken,
      },
      provider,
    );

    try {
      await setOracleTestState({ forced_unavailable: true });
      currentStatus = await refreshWalletStatus(client);
      assert.equal(currentStatus?.oracle_healthy, false, "forced oracle down should flip oracle_healthy=false");

      await updateLocalPolicy({
        max_amount_per_tx_usd: 1000,
        daily_limit_usd: effectiveSpentUsd + 1000,
      });

      await assert.rejects(
        () => signEthereumTransaction(signer, recipient, 1n),
        /price oracle unavailable/i,
      );
    } finally {
      await setOracleTestState({
        forced_unavailable: false,
        snapshot: originalPrices,
      });
      await updateLocalPolicy(buildPolicyRestorePatch(originalPolicy));
      currentStatus = await refreshWalletStatus(client);
    }
  });

  await runStep("supported chain addresses", async () => {
    for (const chainKey of SUPPORTED_EVM_CHAINS) {
      const address = await sandbox.getRequiredAddress(chainKey);
      assert.ok(address.startsWith("0x"), `${chainKey} address should be EVM hex`);
    }
    const solanaAddress = await sandbox.getRequiredAddress("solana");
    assert.ok(solanaAddress.length >= 32, "solana address missing");
    const suiAddress = await sandbox.getRequiredAddress("sui");
    assert.ok(suiAddress.length >= 32, "sui address missing");
    const bitcoinAddress = await sandbox.getRequiredAddress("bitcoin");
    assert.ok(bitcoinAddress.length >= 26, "bitcoin address missing");
  });

  await runStep("wallet bind integration", async () => {
    const challenge = await fetchBindChallenge(uid);
    relayAuth = {
      userID: challenge.user_id,
      jwt: challenge.jwt,
    };
    if (challenge.already_bound === true) {
      currentStatus = await refreshWalletStatus(client);
      return;
    }
    const bindResult = await sandbox.bindWallet({
      message_hash_hex: challenge.message_hash_hex,
    });
    assert.equal(bindResult?.status, "wallet_bound");
    currentStatus = await waitForRelayBound(client);
  });

  await runStep("policy sync merges local and backend blacklists", async () => {
    if (!cfg.relayUrl) {
      return;
    }
    if (!relayAuth) {
      throw new Error("relay auth context missing; run this coverage against a fresh bootstrap");
    }

    const backendOnlyAddress = `0x${randomHex(20)}`;
    const localOnlyAddress = `0x${randomHex(32)}`;

    await addBackendPolicyAddresses(uid, relayAuth, [
      {
        chain: "ethereum",
        wallet_address: backendOnlyAddress,
        type: 1,
        note: "backend-sync-proof",
      },
    ]);

    currentStatus = await sandbox.reactivateWallet();
    assert.equal(currentStatus?.status, "ready");
    const syncedLocalPolicy = await waitForLocalPolicyAddress("ethereum", backendOnlyAddress, "blacklist_to");
    const existingBlacklist = Array.isArray(syncedLocalPolicy?.blacklist_to)
      ? syncedLocalPolicy.blacklist_to
      : [];

    await updateLocalPolicy({
      blacklist_to: [
        ...existingBlacklist,
        {
          chain: "sui",
          address: localOnlyAddress,
          note: "local-sync-proof",
        },
      ],
    });
    currentStatus = await sandbox.reactivateWallet();
    assert.equal(currentStatus?.status, "ready");

    const backendPolicy = await waitForBackendPolicyAddress(
      uid,
      relayAuth,
      "sui",
      localOnlyAddress,
      "blacklisted_addresses",
    );
    assert.ok(
      policyHasAddress(backendPolicy?.blacklisted_addresses, "ethereum", backendOnlyAddress),
      "backend policy should preserve the backend-origin blacklist entry",
    );

    const localPolicy = await waitForLocalPolicyAddress("sui", localOnlyAddress, "blacklist_to");
    assert.ok(
      policyHasAddress(localPolicy?.blacklist_to, "ethereum", backendOnlyAddress),
      "local policy should preserve the backend-origin blacklist entry",
    );
  });

  await runStep("viem RPC proxy eth_blockNumber", async () => {
    await assertRpcProxyBlockNumber("ethereum", "viem");
  });

  await runStep("ethers RPC proxy getBlockNumber", async () => {
    await assertRpcProxyBlockNumber("ethereum", "ethers");
  });

  await runStep("viem RPC proxy eth_blockNumber for supported EVM chains", async () => {
    for (const chainKey of SUPPORTED_EVM_CHAINS.filter((chainKey) => chainKey !== "ethereum")) {
      await assertRpcProxyBlockNumber(chainKey, "viem");
    }
  });

  await runStep("ethers RPC proxy getBlockNumber for supported EVM chains", async () => {
    for (const chainKey of SUPPORTED_EVM_CHAINS.filter((chainKey) => chainKey !== "ethereum")) {
      await assertRpcProxyBlockNumber(chainKey, "ethers");
    }
  });

  await runStep("RPC proxy eth_getBalance for supported EVM chains", async () => {
    for (const chainKey of SUPPORTED_EVM_CHAINS) {
      const address = evmExpectedAddressForChain(currentStatus, chainKey);
      assert.ok(address.startsWith("0x"), `${chainKey} address missing for eth_getBalance`);
      await assertRpcProxyBalance(chainKey, address, "viem");
      await assertRpcProxyBalance(chainKey, address, "ethers");
    }
  });

  await runStep("personal_sign + viem/ethers verification", async () => {
    const { data: st, response: rs } = await client.GET("/api/v1/wallet/status", {});
    assert.equal(rs.status, 200, "wallet/status required for uid");
    const uid = String(st?.uid ?? "").trim();
    const addr = String(st?.address ?? "").trim().toLowerCase();
    assert.ok(uid, "status.uid missing; bind wallet first");
    assert.ok(addr.startsWith("0x"), "status.address missing");

    const message = `claw_wallet_sdk personal_sign test ${Date.now()}`;
    const body = buildPersonalSignBody({
      chain: "ethereum",
      uid,
      message,
    });

    const { data, error, response } = await client.POST("/api/v1/tx/sign", {
      body,
      parseAs: "text",
    });

    const signRaw =
      typeof data === "string"
        ? data
        : typeof error === "string"
          ? error
          : errorText(error);

    assert.equal(
      response.status,
      200,
      `sign failed ${response.status}: ${String(signRaw).slice(0, 400)}`,
    );

    const signed = JSON.parse(signRaw);
    assert.ok(signed.signature_hex, "signature_hex missing");
    assert.ok(signed.from, "from missing");

    const sig = signed.signature_hex;
    const fromLower = String(signed.from).toLowerCase();
    const viemAddr = (await recoverEvmPersonalSignAddress(message, sig)).toLowerCase();
    assert.equal(viemAddr, fromLower);
    assert.equal(viemAddr, addr);

    const ethersAddr = recoverAddressFromPersonalSignEthers(message, sig).toLowerCase();
    assert.equal(ethersAddr, fromLower);
  });

  await runStep("supported EVM personal_sign verification", async () => {
    for (const chainKey of SUPPORTED_EVM_CHAINS.filter((chainKey) => chainKey !== "ethereum")) {
      await assertEvmPersonalSignForChain(client, currentStatus, uid, chainKey);
    }
  });

  await runStep("ClawEthersSigner infers chainId for supported EVM chains", async () => {
    for (const chainKey of SUPPORTED_EVM_CHAINS) {
      await assertProviderInferredEvmTransactionSignForChain(currentStatus, uid, chainKey);
    }
  });

  await runStep("ClawEthersSigner message/typed-data/transaction", async () => {
    const provider = createClawSandboxJsonRpcProvider({
      baseUrl: cfg.baseUrl,
      agentToken: cfg.agentToken,
      chainKey: "ethereum",
    });
    const signer = new ClawEthersSigner(
      {
        uid,
        sandboxUrl: cfg.baseUrl,
        sandboxToken: cfg.agentToken,
      },
      provider,
    );

    const expectedAddress = String(currentStatus?.addresses?.ethereum ?? currentStatus?.address ?? "").trim().toLowerCase();
    assert.equal((await signer.getAddress()).toLowerCase(), expectedAddress);

    const message = `claw_wallet_sdk ethers signer ${Date.now()}`;
    const messageSig = await signer.signMessage(message);
    assert.equal(recoverAddressFromPersonalSignEthers(message, messageSig).toLowerCase(), expectedAddress);

    const typedDomain = {
      name: "claw wallet",
      version: "1",
      chainId: 1,
      verifyingContract: "0x0000000000000000000000000000000000000001",
    };
    const typedTypes = {
      Mail: [{ name: "contents", type: "string" }],
    };
    const typedValue = {
      contents: `hello typed data ${Date.now()}`,
    };
    const typedSig = await signer.signTypedData(typedDomain, typedTypes, typedValue);
    assert.equal(
      verifyTypedDataEthers(typedDomain, typedTypes, typedValue, typedSig).toLowerCase(),
      expectedAddress,
    );

    const txRequest = {
      chainId: 1,
      nonce: 0,
      gasLimit: 21000n,
      gasPrice: 1_000_000_000n,
      to: expectedAddress,
      value: 42n,
      data: "0x",
      type: 0,
    };
    const signedSerialized = await signer.signTransaction(txRequest);

    const parsedSigned = EthersTransaction.from(signedSerialized);
    assert.equal(parsedSigned.from?.toLowerCase(), expectedAddress);
    assert.equal(parsedSigned.to?.toLowerCase(), expectedAddress);
    assert.equal(parsedSigned.value, 42n);
    assert.equal(parsedSigned.nonce, 0);
  });

  await runStep("viem account message/hash/typed-data/transaction", async () => {
    const account = await createClawAccountFromSandbox({
      uid,
      sandboxUrl: cfg.baseUrl,
      sandboxToken: cfg.agentToken,
    });

    const expectedAddress = String(currentStatus?.addresses?.ethereum ?? currentStatus?.address ?? "").trim().toLowerCase();
    assert.equal(account.address.toLowerCase(), expectedAddress);

    const message = `claw_wallet_sdk viem account ${Date.now()}`;
    const messageSig = await account.signMessage({ message });
    assert.equal((await recoverEvmPersonalSignAddress(message, messageSig)).toLowerCase(), expectedAddress);

    const hash = "0x" + "11".repeat(32);
    try {
      const hashSig = await account.sign({ hash });
      assert.equal(recoverEvmAddress(hash, hashSig).toLowerCase(), expectedAddress);
    } catch (error) {
      const text = errorText(error);
      assert.match(text, /blind|raw hash/i, "expected raw_hash signing to fail only due to blind-sign policy");
    }

    const typedData = {
      domain: {
        name: "claw wallet",
        version: "1",
        chainId: 1,
        verifyingContract: "0x0000000000000000000000000000000000000001",
      },
      types: {
        Mail: [{ name: "contents", type: "string" }],
      },
      primaryType: "Mail",
      message: {
        contents: `hello viem typed data ${Date.now()}`,
      },
    };
    const typedSig = await account.signTypedData(typedData);
    assert.equal(
      (await recoverTypedDataAddress({ ...typedData, signature: typedSig })).toLowerCase(),
      expectedAddress,
    );

    const txRequest = {
      chainId: 1,
      nonce: 0,
      gas: 21000n,
      maxFeePerGas: 1_000_000_000n,
      maxPriorityFeePerGas: 100_000_000n,
      to: expectedAddress,
      value: 42n,
      data: "0x",
      type: "eip1559",
    };
    const signedSerialized = await account.signTransaction(txRequest);

    const parsedSigned = EthersTransaction.from(signedSerialized);
    assert.equal(parsedSigned.from?.toLowerCase(), expectedAddress);
    assert.equal(parsedSigned.to?.toLowerCase(), expectedAddress);
    assert.equal(parsedSigned.value, 42n);
    assert.equal(parsedSigned.nonce, 0);
  });

  await runStep("solana signer personal_sign verification", async () => {
    const signer = await ClawSolanaSigner.fromSandbox({
      uid,
      sandboxUrl: cfg.baseUrl,
      sandboxToken: cfg.agentToken,
    });

    const expectedAddress = String(currentStatus?.addresses?.solana ?? "").trim();
    assert.equal(signer.getPublicKey().toBase58(), expectedAddress);

    const message = new TextEncoder().encode(`claw_wallet_sdk solana test ${Date.now()}`);
    const signature = await signer.signMessage(message);
    assert.equal(signature.length, 64, "expected ed25519 signature length");

    const valid = await verifyEd25519Signature(signer.getPublicKey().toBytes(), signature, message);
    assert.equal(valid, true, "solana signature verification failed");
  });

  await runStep("solana signer transaction verification", async () => {
    const signer = await ClawSolanaSigner.fromSandbox({
      uid,
      sandboxUrl: cfg.baseUrl,
      sandboxToken: cfg.agentToken,
    });

    const feePayer = signer.getPublicKey();
    const tx = new Transaction({
      feePayer,
      recentBlockhash: "11111111111111111111111111111111",
    }).add(
      SystemProgram.transfer({
        fromPubkey: feePayer,
        toPubkey: feePayer,
        lamports: 1,
      }),
    );

    const messageBytes = tx.serializeMessage();
    const signedTx = await signer.signTransaction(tx);
    const signerEntry = signedTx.signatures.find((entry) => entry.publicKey.equals(feePayer));
    assert.ok(signerEntry, "expected signer signature entry");
    assert.ok(signerEntry.signature, "expected solana transaction signature bytes");

    const valid = await verifyEd25519Signature(
      feePayer.toBytes(),
      signerEntry.signature,
      messageBytes,
    );
    assert.equal(valid, true, "solana transaction signature verification failed");

    const raw = await sandbox.sign({
      chain: "solana",
      sign_mode: "transaction",
      amount_wei: "0",
      data: "0x",
      tx_payload_hex: bytesToHex(messageBytes),
    });
    assert.equal(
      Buffer.from(signerEntry.signature).toString("hex"),
      raw.signature_hex,
      "solana transaction signature mismatch vs raw sandbox sign",
    );
  });

  await runStep("sui signer personal_sign verification", async () => {
    const signer = await ClawSuiSigner.fromSandbox({
      uid,
      sandboxUrl: cfg.baseUrl,
      sandboxToken: cfg.agentToken,
    });

    const expectedAddress = String(currentStatus?.addresses?.sui ?? "").trim();
    assert.equal(await signer.getAddress(), expectedAddress);

    const message = new TextEncoder().encode(`claw_wallet_sdk sui test ${Date.now()}`);
    const signed = await signer.signPersonalMessage(message);
    assert.ok(signed.signature, "expected serialized Sui signature");
    assert.equal(signed.bytes, Buffer.from(message).toString("base64"));

    const raw = await sandbox.sign({
      chain: "sui",
      sign_mode: "personal_sign",
      tx_payload_hex: bytesToHex(message),
    });
    assert.ok(raw.signature_hex, "expected raw Sui signature");
    assert.ok(raw.from, "expected Sui public key hex");

    const suiPersonalPayload = new Uint8Array(3 + message.length);
    suiPersonalPayload.set([0x03, 0x00, 0x00], 0);
    suiPersonalPayload.set(message, 3);
    const suiPersonalDigest = blake2b(suiPersonalPayload, { dkLen: 32 });

    const rawValid = await verifyEd25519Signature(
      hexToBytes(raw.from),
      hexToBytes(raw.signature_hex),
      suiPersonalDigest,
    );
    assert.equal(rawValid, true, "raw Sui signature verification failed");

    const parsed = parseSerializedSignature(signed.signature);
    assert.equal(Buffer.from(parsed.publicKey).toString("hex"), raw.from);
    assert.equal(Buffer.from(parsed.signature).toString("hex"), raw.signature_hex);

    const parsedAddress = new Ed25519PublicKey(parsed.publicKey).toSuiAddress();
    assert.equal(
      parsedAddress,
      expectedAddress,
      "serialized Sui signature public key does not match expected address",
    );
  });

  await runStep("sui signer transaction verification", async () => {
    const signer = await ClawSuiSigner.fromSandbox({
      uid,
      sandboxUrl: cfg.baseUrl,
      sandboxToken: cfg.agentToken,
    });

    const expectedAddress = String(currentStatus?.addresses?.sui ?? "").trim();
    const txBytes = hexToBytes("000000998877");
    const signed = await signer.signTransactionBlock(txBytes);
    assert.ok(signed.signature, "expected serialized Sui transaction signature");
    assert.equal(signed.bytes, Buffer.from(txBytes).toString("base64"));

    const raw = await sandbox.sign({
      chain: "sui",
      sign_mode: "transaction",
      amount_wei: "0",
      data: "0x",
      tx_payload_hex: bytesToHex(txBytes),
    });
    assert.ok(raw.signature_hex, "expected raw Sui transaction signature");
    assert.ok(raw.from, "expected raw Sui public key");

    const digest = blake2b(txBytes, { dkLen: 32 });
    const rawValid = await verifyEd25519Signature(
      hexToBytes(raw.from),
      hexToBytes(raw.signature_hex),
      digest,
    );
    assert.equal(rawValid, true, "raw Sui transaction signature verification failed");

    const parsed = parseSerializedSignature(signed.signature);
    assert.equal(Buffer.from(parsed.publicKey).toString("hex"), raw.from);
    assert.equal(Buffer.from(parsed.signature).toString("hex"), raw.signature_hex);

    const parsedAddress = new Ed25519PublicKey(parsed.publicKey).toSuiAddress();
    assert.equal(
      parsedAddress,
      expectedAddress,
      "serialized Sui transaction signature public key does not match expected address",
    );
  });

  await runStep("policy write round-trip", async () => {
    const originalPolicy = await sandbox.getLocalPolicy();
    const nextAllowBlindSign = !Boolean(originalPolicy?.allow_blind_sign);
    const nextStrictPlainText = !Boolean(originalPolicy?.strict_plain_text);
    try {
      const updatedPolicy = await updateLocalPolicy({
        allow_blind_sign: nextAllowBlindSign,
        strict_plain_text: nextStrictPlainText,
      });
      assert.equal(updatedPolicy.allow_blind_sign, nextAllowBlindSign);
      assert.equal(updatedPolicy.strict_plain_text, nextStrictPlainText);

      const reloadedPolicy = await sandbox.getLocalPolicy();
      assert.equal(reloadedPolicy.allow_blind_sign, nextAllowBlindSign);
      assert.equal(reloadedPolicy.strict_plain_text, nextStrictPlainText);

      currentStatus = await refreshWalletStatus(client);
      assert.equal(currentStatus?.policy?.allow_blind_sign, nextAllowBlindSign);
      assert.equal(currentStatus?.policy?.strict_plain_text, nextStrictPlainText);
    } finally {
      await updateLocalPolicy(buildPolicyRestorePatch(originalPolicy));
      currentStatus = await refreshWalletStatus(client);
    }
  });

  await runStep("blacklist policy reject and allow", async () => {
    const originalPolicy = await sandbox.getLocalPolicy();
    const expectedAddress = String(currentStatus?.addresses?.ethereum ?? currentStatus?.address ?? "").trim();
    const provider = createClawSandboxJsonRpcProvider({
      baseUrl: cfg.baseUrl,
      agentToken: cfg.agentToken,
      chainKey: "ethereum",
    });
    const signer = new ClawEthersSigner(
      {
        uid,
        sandboxUrl: cfg.baseUrl,
        sandboxToken: cfg.agentToken,
      },
      provider,
    );

    try {
      await updateLocalPolicy({
        blacklist_to: [],
        daily_max_tx_count: 0,
        daily_limit_usd: 0,
      });

      const allowedTx = await signEthereumTransaction(signer, expectedAddress, 0n);
      assert.equal(allowedTx.to?.toLowerCase(), expectedAddress.toLowerCase());

      await updateLocalPolicy({
        blacklist_to: [{ address: expectedAddress, chain: "ethereum", note: "blocked self" }],
        daily_max_tx_count: 0,
        daily_limit_usd: 0,
      });

      await assert.rejects(
        () => signEthereumTransaction(signer, expectedAddress, 0n),
        /BLACKLISTED/i,
      );
    } finally {
      await updateLocalPolicy(buildPolicyRestorePatch(originalPolicy));
      currentStatus = await refreshWalletStatus(client);
    }
  });

  await runStep("daily transaction count risk control", async () => {
    const originalPolicy = await sandbox.getLocalPolicy();
    currentStatus = await refreshWalletStatus(client);
    const expectedAddress = String(currentStatus?.addresses?.ethereum ?? currentStatus?.address ?? "").trim();
    const effectiveTxCount = Number(currentStatus?.today_effective_tx_count ?? 0);
    const provider = createClawSandboxJsonRpcProvider({
      baseUrl: cfg.baseUrl,
      agentToken: cfg.agentToken,
      chainKey: "ethereum",
    });
    const signer = new ClawEthersSigner(
      {
        uid,
        sandboxUrl: cfg.baseUrl,
        sandboxToken: cfg.agentToken,
      },
      provider,
    );

    try {
      await updateLocalPolicy({
        daily_max_tx_count: effectiveTxCount + 1,
        daily_limit_usd: 0,
        blacklist_to: [],
      });

      await signEthereumTransaction(signer, expectedAddress, 0n);
      await assert.rejects(
        () => signEthereumTransaction(signer, expectedAddress, 0n),
        /daily transaction count limit reached/i,
      );
    } finally {
      await updateLocalPolicy(buildPolicyRestorePatch(originalPolicy));
      currentStatus = await refreshWalletStatus(client);
    }
  });

  await runStep("daily USD limit risk control", async () => {
    const originalPolicy = await sandbox.getLocalPolicy();
    currentStatus = await refreshWalletStatus(client);
    const expectedAddress = String(currentStatus?.addresses?.ethereum ?? currentStatus?.address ?? "").trim();
    const effectiveSpentUsd = Number(currentStatus?.today_effective_spent_usd ?? 0);
    const priceProbe = await client.GET("/api/v1/price/cache", {});
    assert.equal(priceProbe.response.status, 200, "price cache required for daily USD test");
    const nativeEthereumPrice = getNativeEthereumPrice(priceProbe.data);
    const targetIntentUsd = Math.max(5, Math.min(25, nativeEthereumPrice / 100));
    const valueWei = weiForUsd(targetIntentUsd, nativeEthereumPrice);
    const provider = createClawSandboxJsonRpcProvider({
      baseUrl: cfg.baseUrl,
      agentToken: cfg.agentToken,
      chainKey: "ethereum",
    });
    const signer = new ClawEthersSigner(
      {
        uid,
        sandboxUrl: cfg.baseUrl,
        sandboxToken: cfg.agentToken,
      },
      provider,
    );

    try {
      await updateLocalPolicy({
        max_amount_per_tx_usd: Math.max(100, targetIntentUsd * 3),
        daily_limit_usd: effectiveSpentUsd + targetIntentUsd * 1.5,
        blacklist_to: [],
      });

      await signEthereumTransaction(signer, expectedAddress, valueWei);
      await assert.rejects(
        () => signEthereumTransaction(signer, expectedAddress, valueWei),
        /daily USD spend limit exceeded/i,
      );
    } finally {
      await updateLocalPolicy(buildPolicyRestorePatch(originalPolicy));
      currentStatus = await refreshWalletStatus(client);
    }
  });

  await runStep("uniswap v3 swap smoke", async () => {
    const { data: st, response: rs } = await client.GET("/api/v1/wallet/status", {});
    assert.equal(rs.status, 200);
    const uid = String(st?.uid ?? "").trim();
    assert.ok(uid, "uid required");

    await assertSwapSmoke(
      client,
      "/api/v1/tx/swap/uniswap_v3",
      {
        chain: "ethereum",
        uid,
        token_in: "native",
        token_out: ETHEREUM_USDC,
        amount_in_wei: "1",
        amount_out_min_wei: "0",
        fee: 3000,
      },
      (parsed) => {
        assert.equal(String(parsed.chain ?? "").toLowerCase(), "ethereum");
        assert.equal(String(parsed.token_in ?? "").toLowerCase(), "native");
        assert.equal(String(parsed.token_out ?? "").toLowerCase(), ETHEREUM_USDC.toLowerCase());
        assert.ok(parsed.swap_submitted_id || parsed.swap_tx_hash, "swap success should include submission id or tx hash");
      },
    );
  });

  await runStep("uniswap v2 swap smoke", async () => {
    const { data: st, response: rs } = await client.GET("/api/v1/wallet/status", {});
    assert.equal(rs.status, 200);
    const uid = String(st?.uid ?? "").trim();
    assert.ok(uid, "uid required");

    await assertSwapSmoke(
      client,
      "/api/v1/tx/swap/uniswap_v2",
      {
        chain: "ethereum",
        uid,
        token_in: "native",
        token_out: ETHEREUM_USDC,
        amount_in_wei: "1",
        amount_out_min_wei: "0",
      },
      (parsed) => {
        assert.equal(String(parsed.chain ?? "").toLowerCase(), "ethereum");
        assert.equal(String(parsed.token_in ?? "").toLowerCase(), "native");
        assert.equal(String(parsed.token_out ?? "").toLowerCase(), ETHEREUM_USDC.toLowerCase());
        assert.ok(parsed.swap_submitted_id || parsed.swap_tx_hash, "swap success should include submission id or tx hash");
      },
    );
  });

  await runStep("jupiter swap smoke", async () => {
    const { data: st, response: rs } = await client.GET("/api/v1/wallet/status", {});
    assert.equal(rs.status, 200);
    const uid = String(st?.uid ?? "").trim();
    assert.ok(uid, "uid required");

    await assertSwapSmoke(
      client,
      "/api/v1/tx/swap/solana-jup",
      {
        chain: "solana",
        uid,
        token_in: "native",
        token_out: SOLANA_USDC,
        amount_in_wei: "1",
      },
      (parsed) => {
        assert.equal(String(parsed.chain ?? "").toLowerCase(), "solana");
        assert.equal(String(parsed.token_in ?? "").toLowerCase(), "native");
        assert.equal(String(parsed.token_out ?? "").toLowerCase(), SOLANA_USDC.toLowerCase());
        assert.ok(parsed.submitted_id || parsed.signature, "jupiter success should include submitted_id or signature");
      },
    );
  });

  await runStep("cetus swap smoke", async () => {
    const { data: st, response: rs } = await client.GET("/api/v1/wallet/status", {});
    assert.equal(rs.status, 200);
    const uid = String(st?.uid ?? "").trim();
    assert.ok(uid, "uid required");

    await assertSwapSmoke(
      client,
      "/api/v1/tx/swap/sui-cetus",
      {
        chain: "sui",
        uid,
        token_in: SUI_NATIVE_COIN,
        token_out: SUI_CETUS_COIN,
        amount_wei: "1",
      },
      (parsed) => {
        assert.equal(String(parsed.chain ?? "").toLowerCase(), "sui");
        assert.equal(String(parsed.token_in ?? ""), SUI_NATIVE_COIN);
        assert.equal(String(parsed.token_out ?? ""), SUI_CETUS_COIN);
        assert.ok(parsed.digest || parsed.request_id, "cetus success should include digest or request_id");
      },
    );
  });

  await runStep("transfer smoke", async () => {
    const { data: st, response: rs } = await client.GET("/api/v1/wallet/status", {});
    assert.equal(rs.status, 200);
    const uid = String(st?.uid ?? "").trim();
    const addr = String(st?.address ?? "").trim();
    assert.ok(uid && addr, "uid and address required");

    const { data, error, response } = await client.POST("/api/v1/tx/transfer", {
      body: {
        chain: "ethereum",
        uid,
        to: addr,
        amount_wei: "1",
      },
      parseAs: "text",
    });

    const transferRaw =
      typeof data === "string"
        ? data
        : typeof error === "string"
          ? error
          : "";

    if (response.ok) {
      assert.ok(transferRaw, "transfer 200 should include body");
      JSON.parse(transferRaw);
      return;
    }

    const text = transferRaw.slice(0, 800);
    const acceptable =
      FUNDS_LIKE.test(text) ||
      SANDBOX_GATE.test(text) ||
      TRANSIENT_RPC_FAILURE.test(text) ||
      response.status === 409 ||
      response.status === 403 ||
      response.status === 400;
    assert.ok(
      acceptable,
      `expected funds/gas-like or sandbox policy gate, got status=${response.status}: ${text}`,
    );
  });

  await runStep("bitcoin transfer smoke", async () => {
    const bitcoinAddress = await sandbox.getRequiredAddress("bitcoin");
    const { data, error, response } = await client.POST("/api/v1/tx/transfer", {
      body: {
        chain: "bitcoin",
        uid,
        to: bitcoinAddress,
        amount_wei: "1",
      },
      parseAs: "text",
    });

    const transferRaw =
      typeof data === "string"
        ? data
        : typeof error === "string"
          ? error
          : "";

    if (response.ok) {
      assert.ok(transferRaw, "bitcoin transfer 200 should include body");
      JSON.parse(transferRaw);
      return;
    }

    const text = transferRaw.slice(0, 800);
    const acceptable =
      FUNDS_LIKE.test(text) ||
      /utxo|bitcoin balance|does not have any bitcoin utxos/i.test(text) ||
      SANDBOX_GATE.test(text) ||
      TRANSIENT_RPC_FAILURE.test(text) ||
      response.status === 409 ||
      response.status === 403 ||
      response.status === 400;
    assert.ok(
      acceptable,
      `expected bitcoin funds/utxo-like or sandbox gate failure, got status=${response.status}: ${text}`,
    );
  });

  await runStep("0g transaction sign smoke", async () => {
    await assertEvmTransactionSignForChain(client, sandbox, currentStatus, uid, "0g");
  });

  await runStep("monad transaction sign smoke", async () => {
    await assertEvmTransactionSignForChain(client, sandbox, currentStatus, uid, "monad");
  });

  await runStep("0g transfer smoke", async () => {
    await assertTransferSmokeForChain(client, currentStatus, uid, "0g");
  });

  await runStep("monad transfer smoke", async () => {
    await assertTransferSmokeForChain(client, currentStatus, uid, "monad");
  });

  process.stdout.write("integration smoke passed\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
