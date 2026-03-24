/**
 * Signing, verification (viem + ethers), RPC via adapters, and transfer smoke test.
 * Requires unlocked / activated sandbox wallet for sign + transfer attempts.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

import { createClawWalletClient, buildPersonalSignBody } from "../dist/index.js";
import {
  createClawSandboxPublicClient,
  recoverEvmPersonalSignAddress,
} from "../dist/viem.js";
import {
  createClawSandboxJsonRpcProvider,
  recoverAddressFromPersonalSignEthers,
} from "../dist/ethers.js";
import { loadIntegrationConfig } from "./load-integration-config.mjs";

/** On-chain / gas / balance failures (expected when wallet is empty). */
const FUNDS_LIKE =
  /insufficient|underflow|balance|funds|fund|gas|fee|intrinsic|overshot|exceed|need more|too low|cannot afford|execution reverted|revert|nonce too|replacement/i;

/** Sandbox policy / first-transfer UX — not an SDK regression. */
const SANDBOX_GATE =
  /confirmation|first outbound|requires confirm|policy|whitelist|blacklist|share2|gate|relay/i;

function errorText(error, response) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String(/** @type {{ message?: string }} */ (error).message);
  }
  return "";
}

let cfg;

before(() => {
  cfg = loadIntegrationConfig();
});

describe("claw_wallet_sdk signing + viem/ethers + transfer", () => {
  it("viem: read-only RPC via sandbox proxy (eth_blockNumber)", async () => {
    if (!cfg.agentToken) {
      console.log("[skip] no agent token for authenticated /api/rpc");
      return;
    }
    const client = createClawSandboxPublicClient({
      baseUrl: cfg.baseUrl,
      agentToken: cfg.agentToken,
      chainKey: "ethereum",
    });
    const n = await client.getBlockNumber();
    assert.ok(typeof n === "bigint");
    assert.ok(n > 0n);
  });

  it("ethers: read-only RPC via sandbox proxy (getBlockNumber)", async () => {
    if (!cfg.agentToken) {
      console.log("[skip] no agent token for authenticated /api/rpc");
      return;
    }
    const provider = createClawSandboxJsonRpcProvider({
      baseUrl: cfg.baseUrl,
      agentToken: cfg.agentToken,
      chainKey: "ethereum",
    });
    const n = await provider.getBlockNumber();
    assert.ok(Number.isFinite(n));
    assert.ok(n > 0);
  });

  it("POST personal_sign then verify with viem + ethers", async () => {
    if (!cfg.agentToken) {
      console.log("[skip] no agent token");
      return;
    }
    const client = createClawWalletClient({
      baseUrl: cfg.baseUrl,
      agentToken: cfg.agentToken,
    });
    const { data: st, response: rs } = await client.GET(
      "/api/v1/wallet/status",
      {},
    );
    assert.equal(rs.status, 200, "wallet/status required for uid");
    const uid = String(st?.uid ?? "").trim();
    const addr = String(st?.address ?? "").trim().toLowerCase();
    assert.ok(uid, "status.uid missing — bind wallet first");
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
          : errorText(error, response);

    if (response.status === 401) {
      assert.fail(
        `wallet locked or inactive (401). Unlock sandbox first. Body: ${String(signRaw).slice(0, 200)}`,
      );
    }

    assert.equal(
      response.status,
      200,
      `sign failed ${response.status}: ${String(signRaw).slice(0, 400)}`,
    );

    let signed;
    try {
      signed = JSON.parse(/** @type {string} */ (signRaw));
    } catch {
      assert.fail(`sign 200 but body is not JSON: ${String(signRaw).slice(0, 200)}`);
    }

    assert.ok(signed.signature_hex, "signature_hex missing");
    assert.ok(signed.from, "from missing");

    const sig = signed.signature_hex;
    const fromLower = String(signed.from).toLowerCase();

    const viemAddr = (
      await recoverEvmPersonalSignAddress(message, sig)
    ).toLowerCase();
    assert.equal(
      viemAddr,
      fromLower,
      "viem recoverMessageAddress should match sandbox from",
    );
    assert.equal(
      viemAddr,
      addr,
      "recovered address should match wallet status ethereum address",
    );

    const ethersAddr =
      recoverAddressFromPersonalSignEthers(message, sig).toLowerCase();
    assert.equal(ethersAddr, fromLower);
  });

  it("POST transfer: success or expected funds/gas style failure", async () => {
    if (!cfg.agentToken) {
      console.log("[skip] no agent token");
      return;
    }
    const client = createClawWalletClient({
      baseUrl: cfg.baseUrl,
      agentToken: cfg.agentToken,
    });
    const { data: st, response: rs } = await client.GET(
      "/api/v1/wallet/status",
      {},
    );
    assert.equal(rs.status, 200);
    const uid = String(st?.uid ?? "").trim();
    const addr = String(st?.address ?? "").trim();
    assert.ok(uid && addr, "uid and address required");

    const { data, error, response } = await client.POST(
      "/api/v1/tx/transfer",
      {
        body: {
          chain: "ethereum",
          uid,
          to: addr,
          amount_wei: "1",
        },
        parseAs: "text",
      },
    );

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
      response.status === 409 ||
      response.status === 403;
    assert.ok(
      acceptable,
      `expected funds/gas-like or sandbox policy gate, got status=${response.status}: ${text}`,
    );
  });
});
