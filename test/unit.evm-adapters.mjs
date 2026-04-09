import assert from "node:assert/strict";

import { Transaction } from "ethers";

import { ClawEthersSigner } from "../dist/ethers.js";

const SIGNATURE_HEX =
  "0x"
  + "11".repeat(32)
  + "22".repeat(32)
  + "00";

const SANDBOX_RESULT = {
  signature_hex: SIGNATURE_HEX,
  from: "0x0000000000000000000000000000000000000001",
};

function installSandboxSignStub(expectedChain) {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const request = new Request(input, init);
    const url = request.url;
    if (!url.endsWith("/api/v1/tx/sign")) {
      throw new Error(`unexpected fetch url: ${url}`);
    }

    const body = JSON.parse((await request.text()) || "{}");
    calls.push(body);
    assert.equal(body.chain, expectedChain);

    return new Response(JSON.stringify(SANDBOX_RESULT), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

{
  const stub = installSandboxSignStub("bsc");
  try {
    const signer = new ClawEthersSigner(
      {
        uid: "u1",
        sandboxUrl: "https://sandbox.example",
        sandboxToken: "token",
      },
      { getNetwork: async () => ({ chainId: 56n }) },
      "0x0000000000000000000000000000000000000001",
    );

    const signed = await signer.signTransaction({
      from: "0x0000000000000000000000000000000000000001",
      nonce: 7,
      gasLimit: 21_000n,
      gasPrice: 1_000_000_000n,
      to: "0x00000000000000000000000000000000000000AA",
      value: 42n,
      data: "0x",
      type: 0,
    });

    const parsed = Transaction.from(signed);
    assert.equal(parsed.chainId, 56n);
    assert.equal(parsed.to?.toLowerCase(), "0x00000000000000000000000000000000000000aa");
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
}

{
  const stub = installSandboxSignStub("bsc");
  try {
    let broadcastRawTx = "";
    const signer = new ClawEthersSigner(
      {
        uid: "u1",
        sandboxUrl: "https://sandbox.example",
        sandboxToken: "token",
      },
      {
        getNetwork: async () => ({ chainId: 56n }),
        getFeeData: async () => ({ gasPrice: 1_000_000_000n }),
        broadcastTransaction: async (rawTx) => {
          broadcastRawTx = rawTx;
          return {
            hash: "0x" + "ab".repeat(32),
            wait: async () => null,
          };
        },
      },
      "0x0000000000000000000000000000000000000001",
    );

    const pending = await signer.sendTransaction({
      nonce: 8,
      gasLimit: 21_000n,
      gasPrice: 1_000_000_000n,
      chainId: 56,
      to: "0x00000000000000000000000000000000000000AA",
      value: 7n,
      data: "0x",
      type: 0,
    });

    assert.ok(broadcastRawTx.startsWith("0x"));
    assert.equal(pending.hash, "0x" + "ab".repeat(32));
    assert.equal(stub.calls.length, 1);
    const parsed = Transaction.from(broadcastRawTx);
    assert.equal(parsed.chainId, 56n);
    assert.equal(parsed.to?.toLowerCase(), "0x00000000000000000000000000000000000000aa");
  } finally {
    stub.restore();
  }
}

{
  const stub = installSandboxSignStub("kite");
  try {
    const signer = new ClawEthersSigner(
      {
        uid: "u1",
        sandboxUrl: "https://sandbox.example",
        sandboxToken: "token",
        chain: "kite",
      },
      null,
      "0x0000000000000000000000000000000000000001",
    );

    const signed = await signer.signTransaction({
      nonce: 9,
      gasLimit: 21_000n,
      gasPrice: 1_000_000_000n,
      to: "0x00000000000000000000000000000000000000AA",
      value: 99n,
      data: "0x",
      type: 0,
    });

    const parsed = Transaction.from(signed);
    assert.equal(parsed.chainId, 2366n);
    assert.equal(parsed.to?.toLowerCase(), "0x00000000000000000000000000000000000000aa");
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].chain, "kite");
  } finally {
    stub.restore();
  }
}

process.stdout.write("unit evm adapters passed\n");
