import assert from "node:assert/strict";

import { ClawSandboxClient } from "../dist/index.js";
import {
  chainIdToClawChain,
  clawChainToChainId,
  resolveClawEvmChain,
} from "../dist/evm-chain.js";

function installStatusStub(statusBody) {
  const calls = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init = {}) => {
    const request = new Request(input, init);
    calls.push(request.url);
    if (!request.url.endsWith("/api/v1/wallet/status")) {
      throw new Error(`unexpected fetch url: ${request.url}`);
    }
    return new Response(JSON.stringify(statusBody), {
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
  assert.equal(clawChainToChainId("0g"), 16661n);
  assert.equal(clawChainToChainId("monad"), 143n);
  assert.equal(clawChainToChainId("kite"), 2366n);
  assert.equal(clawChainToChainId("tempo"), 42431n);

  assert.equal(chainIdToClawChain(16661n), "0g");
  assert.equal(chainIdToClawChain(143), "monad");
  assert.equal(chainIdToClawChain(2366), "kite");
  assert.equal(chainIdToClawChain(42431n), "tempo");

  assert.equal(resolveClawEvmChain(undefined, 2366), "kite");
  assert.equal(resolveClawEvmChain(undefined, 42431), "tempo");
}

{
  const stub = installStatusStub({
    address: "0x00000000000000000000000000000000000000aa",
    addresses: {
      ethereum: "0x00000000000000000000000000000000000000aa",
    },
  });

  try {
    const sandbox = new ClawSandboxClient({
      uid: "u1",
      sandboxUrl: "https://sandbox.example",
      sandboxToken: "token",
    });

    assert.equal(
      await sandbox.getRequiredAddress("kite"),
      "0x00000000000000000000000000000000000000aa",
    );
    assert.equal(
      await sandbox.getRequiredAddress("tempo"),
      "0x00000000000000000000000000000000000000aa",
    );
    await assert.rejects(
      () => sandbox.getRequiredAddress("tron"),
      /did not include a tron address/i,
    );
  } finally {
    stub.restore();
  }
}

process.stdout.write("unit chain support passed\n");
