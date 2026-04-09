import assert from "node:assert/strict";

import {
  buildPersonalSignBody,
  ClawSandboxClient,
  createClawWalletClient,
} from "../dist/index.js";
import {
  createClawSandboxPublicClient,
  recoverEvmPersonalSignAddress,
} from "../dist/viem.js";
import {
  ClawEthersSigner,
  createClawSandboxJsonRpcProvider,
  recoverAddressFromPersonalSignEthers,
} from "../dist/ethers.js";
import { Signature, Transaction as EthersTransaction } from "ethers";
import { loadIntegrationConfig } from "./load-integration-config.mjs";

const cfg = loadIntegrationConfig();
const FETCH_TIMEOUT_MS = Number(process.env.CLAW_TEST_FETCH_TIMEOUT_MS ?? "60000");

function timeoutSignal(ms, existing) {
  const signal = AbortSignal.timeout(ms);
  if (!existing) return signal;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([existing, signal]);
  }
  return signal;
}

async function timedFetch(input, init = {}) {
  return fetch(input, { ...init, signal: timeoutSignal(FETCH_TIMEOUT_MS, init.signal) });
}

function errorText(error) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return "";
}

function isRetryableNetworkError(error) {
  const text = String(error instanceof Error ? error.message : error ?? "");
  return /502|503|504|bad gateway|failed to detect network|timeout|temporar|upstream connect error|invalid json was received by the server|cannot parse json-rpc response|too many connections/i.test(text);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function acceptableTransferFailure(text, status) {
  return (
    /insufficient|underflow|balance|funds|fund|gas|fee|intrinsic|overshot|exceed|need more|too low|cannot afford|execution reverted|revert|nonce too|replacement/i.test(text) ||
    /confirmation|first outbound|requires confirm|policy|whitelist|blacklist|share2|gate|relay/i.test(text) ||
    /too many connections|rpc .* failed|eth_chainId failed|temporar|bad gateway|timeout|retry later|refresh/i.test(text) ||
    status === 409 ||
    status === 403 ||
    status === 400 ||
    status === 503
  );
}

const client = createClawWalletClient({
  baseUrl: cfg.baseUrl,
  agentToken: cfg.agentToken || undefined,
  fetch: timedFetch,
});

const { data: status, response: statusResponse } = await client.GET("/api/v1/wallet/status", {});
assert.equal(statusResponse.status, 200, "wallet/status required");

const uid = String(status?.uid ?? "").trim();
assert.ok(uid, "wallet/status missing uid");

const ethereumAddress = String(status?.addresses?.ethereum ?? status?.address ?? "").trim().toLowerCase();
assert.ok(ethereumAddress.startsWith("0x"), "wallet/status missing ethereum address");

const sandbox = new ClawSandboxClient({
  uid,
  sandboxUrl: cfg.baseUrl,
  sandboxToken: cfg.agentToken || "",
  fetch: timedFetch,
});

const kiteAddress = (await sandbox.getRequiredAddress("kite")).toLowerCase();
assert.equal(kiteAddress, ethereumAddress, "kite should resolve to ethereum fallback address");

const refresh = await sandbox.refreshChain("kite");
const refreshStatus = String(refresh?.status ?? "");
assert.ok(
  ["refresh_completed", "refresh_waited_existing", "refresh_skipped_recent"].includes(refreshStatus),
  `unexpected kite refresh status: ${refreshStatus}`,
);

const viemClient = createClawSandboxPublicClient({
  baseUrl: cfg.baseUrl,
  agentToken: cfg.agentToken,
  chainKey: "kite",
});
const blockNumber = await withRetry(() => viemClient.getBlockNumber());
assert.ok(blockNumber > 0n, "kite block number should be positive");
const balance = await withRetry(() => viemClient.getBalance({ address: kiteAddress }));
assert.ok(balance >= 0n, "kite balance should be non-negative");

const provider = createClawSandboxJsonRpcProvider({
  baseUrl: cfg.baseUrl,
  agentToken: cfg.agentToken,
  chainKey: "kite",
});
const rawChainId = await withRetry(() => provider.send("eth_chainId", []));
assert.equal(Number.parseInt(String(rawChainId), 16), 2366, "kite eth_chainId should be 2366");

const personalMessage = `claw_wallet_sdk kite personal_sign ${Date.now()}`;
const personalBody = buildPersonalSignBody({
  chain: "kite",
  uid,
  message: personalMessage,
});
const { data: signData, error: signError, response: signResponse } = await client.POST("/api/v1/tx/sign", {
  body: personalBody,
  parseAs: "text",
});
const signRaw =
  typeof signData === "string" ? signData : typeof signError === "string" ? signError : errorText(signError);
assert.equal(signResponse.status, 200, `kite personal_sign failed: ${signRaw}`);
const signed = JSON.parse(signRaw);
assert.ok(signed.signature_hex, "kite signature_hex missing");
assert.equal(String(signed.from).toLowerCase(), kiteAddress, "kite personal_sign signer mismatch");
assert.equal((await recoverEvmPersonalSignAddress(personalMessage, signed.signature_hex)).toLowerCase(), kiteAddress);
assert.equal(recoverAddressFromPersonalSignEthers(personalMessage, signed.signature_hex).toLowerCase(), kiteAddress);

const ethersSigner = new ClawEthersSigner(
  {
    uid,
    sandboxUrl: cfg.baseUrl,
    sandboxToken: cfg.agentToken || "",
    chain: "kite",
    fetch: timedFetch,
  },
  null,
  kiteAddress,
);
const signedTx = await ethersSigner.signTransaction({
  nonce: 0,
  gasLimit: 21_000n,
  gasPrice: 1_000_000_000n,
  to: kiteAddress,
  value: 42n,
  data: "0x",
  type: 0,
});
const parsedSignedTx = EthersTransaction.from(signedTx);
assert.equal(parsedSignedTx.chainId, 2366n, "kite signed tx should use chainId 2366");
assert.equal(parsedSignedTx.from?.toLowerCase(), kiteAddress, "kite signed tx from mismatch");
assert.equal(parsedSignedTx.to?.toLowerCase(), kiteAddress, "kite signed tx to mismatch");
assert.ok(Signature.from(parsedSignedTx.signature).serialized, "kite tx signature should be parseable");

const { data: transferData, error: transferError, response: transferResponse } = await client.POST("/api/v1/tx/transfer", {
  body: {
    chain: "kite",
    uid,
    to: kiteAddress,
    amount_wei: "1",
  },
  parseAs: "text",
});
const transferRaw =
  typeof transferData === "string" ? transferData : typeof transferError === "string" ? transferError : errorText(transferError);
if (transferResponse.ok) {
  const parsed = JSON.parse(transferRaw);
  if (parsed.chain) {
    assert.equal(String(parsed.chain).toLowerCase(), "kite", "kite transfer response chain mismatch");
  }
} else {
  assert.ok(
    acceptableTransferFailure(transferRaw.slice(0, 800), transferResponse.status),
    `unexpected kite transfer failure ${transferResponse.status}: ${transferRaw.slice(0, 800)}`,
  );
}

const priceProbe = await client.GET("/api/v1/price/cache", {});
assert.equal(priceProbe.response.status, 200, "price cache required");
const kitePrice = Number(priceProbe.data?.prices?.["native:kite"] ?? 0);
assert.ok(kitePrice > 0, "native:kite price missing from /api/v1/price/cache");

process.stdout.write("kite integration passed\n");
