import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
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

async function runStep(name, fn) {
  process.stdout.write(`- ${name} ... `);
  await fn();
  process.stdout.write("ok\n");
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

const cfg = loadIntegrationConfig();

async function main() {
  const client = createClawWalletClient({
    baseUrl: cfg.baseUrl,
    agentToken: cfg.agentToken || undefined,
  });

  await runStep("GET /health", async () => {
    const { data, error, response } = await client.GET("/health", {});
    assert.equal(response.status, 200, `health failed: ${error ?? response.statusText}`);
    assert.ok(data, "expected JSON body");
    assert.equal(data.status, "ok");
  });

  if (!cfg.agentToken) {
    throw new Error(`No sandbox token found in env or ${cfg.envPath}`);
  }

  const { data: currentStatus, response: statusResponse } = await client.GET("/api/v1/wallet/status", {});
  assert.equal(statusResponse.status, 200, "wallet/status required for integration runner");

  const statusUid = String(currentStatus?.uid ?? "").trim();
  assert.ok(statusUid, "wallet/status did not include uid");
  const envUid = String(process.env.CLAY_UID?.trim() || "").trim();
  if (envUid && envUid !== statusUid) {
    throw new Error(`CLAY_UID mismatch: env=${envUid} status=${statusUid}`);
  }
  const uid = statusUid;

  const sandbox = new ClawSandboxClient({
    uid,
    sandboxUrl: cfg.baseUrl,
    sandboxToken: cfg.agentToken || "",
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
  });

  await runStep("reject wrong bearer", async () => {
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
      return;
    }

    const { response, data, error } = await client.POST("/api/v1/wallet/reactivate", {
      parseAs: "text",
    });
    const text = typeof data === "string" ? data : typeof error === "string" ? error : "";
    if (response.status === 200) {
      const body = JSON.parse(text);
      assert.equal(body.status, "ready");
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

  await runStep("viem RPC proxy eth_blockNumber", async () => {
    const n = await withRetry(async () => {
      const publicClient = createClawSandboxPublicClient({
        baseUrl: cfg.baseUrl,
        agentToken: cfg.agentToken,
        chainKey: "ethereum",
      });
      return publicClient.getBlockNumber();
    });
    assert.ok(typeof n === "bigint");
    assert.ok(n > 0n);
  });

  await runStep("ethers RPC proxy getBlockNumber", async () => {
    const n = await withRetry(async () => {
      const provider = createClawSandboxJsonRpcProvider({
        baseUrl: cfg.baseUrl,
        agentToken: cfg.agentToken,
        chainKey: "ethereum",
      });
      return provider.getBlockNumber();
    });
    assert.ok(Number.isFinite(n));
    assert.ok(n > 0);
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
    const unsignedTx = EthersTransaction.from(txRequest);
    const raw = await sandbox.sign({
      chain: "ethereum",
      sign_mode: "transaction",
      confirmed_by_user: true,
      to: txRequest.to,
      amount_wei: txRequest.value.toString(),
      data: "0x",
      tx_payload_hex: unsignedTx.unsignedSerialized,
    });
    const signedSerialized = await signer.signTransaction(txRequest);
    const expectedSigned = EthersTransaction.from(txRequest);
    expectedSigned.signature = raw.signature_hex;
    assert.equal(signedSerialized, expectedSigned.serialized);

    const parsedSigned = EthersTransaction.from(signedSerialized);
    assert.equal(parsedSigned.from?.toLowerCase(), expectedAddress);
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
    const rawUnsigned = EthersTransaction.from({
      chainId: txRequest.chainId,
      nonce: txRequest.nonce,
      gasLimit: txRequest.gas,
      maxFeePerGas: txRequest.maxFeePerGas,
      maxPriorityFeePerGas: txRequest.maxPriorityFeePerGas,
      to: txRequest.to,
      value: txRequest.value,
      data: txRequest.data,
      type: 2,
    });
    const raw = await sandbox.sign({
      chain: "ethereum",
      sign_mode: "transaction",
      confirmed_by_user: true,
      to: txRequest.to,
      amount_wei: txRequest.value.toString(),
      data: "0x",
      tx_payload_hex: rawUnsigned.unsignedSerialized,
    });
    const signedSerialized = await account.signTransaction(txRequest);
    const expectedSigned = EthersTransaction.from({
      chainId: txRequest.chainId,
      nonce: txRequest.nonce,
      gasLimit: txRequest.gas,
      maxFeePerGas: txRequest.maxFeePerGas,
      maxPriorityFeePerGas: txRequest.maxPriorityFeePerGas,
      to: txRequest.to,
      value: txRequest.value,
      data: txRequest.data,
      type: 2,
    });
    expectedSigned.signature = raw.signature_hex;
    assert.equal(signedSerialized, expectedSigned.serialized);

    const parsedSigned = EthersTransaction.from(signedSerialized);
    assert.equal(parsedSigned.from?.toLowerCase(), expectedAddress);
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

  process.stdout.write("integration smoke passed\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
