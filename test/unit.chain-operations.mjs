import assert from "node:assert/strict";
import http from "node:http";

import { ClawEthersSigner } from "../dist/evm/ethers.js";
import { ClawSolanaSigner } from "../dist/solana/solana.js";
import { ClawSuiSigner } from "../dist/sui/sui.js";
import { ClawValidationError } from "../dist/index.js";

const calls = [];

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
  });
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : undefined;
    calls.push({ method: req.method, url: req.url, body });

    res.writeHead(200, { "Content-Type": "application/json" });
    if (req.url === "/api/v1/tx/swap/evm") {
      res.end(JSON.stringify({
        chain: body.chain,
        from: "0xabc",
        token_in: body.token_in,
        token_out: body.token_out,
        amount_in_wei: body.amount_in_wei,
        approval_required: false,
      }));
      return;
    }
    if (req.url === "/api/v1/tx/swap/solana") {
      res.end(JSON.stringify({
        chain: "solana",
        from: "sol-from",
        token_in: body.token_in,
        token_out: body.token_out,
        amount_in_wei: body.amount_in_wei,
        slippage_bps: body.slippage_bps,
        as_legacy_transaction: false,
        used_versioned_tx: true,
        jupiter_program: "jup",
        sponsored: true,
      }));
      return;
    }
    if (req.url === "/api/v1/tx/swap/sui") {
      res.end(JSON.stringify({
        chain: "sui",
        from: "sui-from",
        wallet: "sui-from",
        token_in: body.token_in,
        token_out: body.token_out,
        amount_wei: body.amount_wei,
        by_amount_in: true,
        slippage: 0.005,
        request_id: "req",
        sponsored: true,
      }));
      return;
    }
    res.end(JSON.stringify({ ok: true }));
  });
});

await new Promise((resolve) => {
  server.listen(0, "127.0.0.1", resolve);
});

try {
  const address = server.address();
  assert.ok(address && typeof address === "object", "test server did not expose a socket address");
  const config = {
    sandboxUrl: `http://127.0.0.1:${address.port}`,
    sandboxToken: "",
  };
  const evmSigner = new ClawEthersSigner(config);
  const solanaSigner = new ClawSolanaSigner(config, "11111111111111111111111111111111");
  const suiSigner = new ClawSuiSigner(config, "0x1");

  await assert.rejects(
    () => evmSigner.swap({
      chain: "base",
      tokenOut: "0x0000000000000000000000000000000000000001",
      amountIn: "",
    }),
    (error) => {
      assert.ok(error instanceof ClawValidationError);
      assert.equal(error.field, "amountIn");
      return true;
    },
  );

  await assert.rejects(
    () => solanaSigner.invoke({}),
    (error) => {
      assert.ok(error instanceof ClawValidationError);
      assert.equal(error.field, "unsignedTxBase64");
      return true;
    },
  );

  await assert.rejects(
    () => suiSigner.swap({
      tokenIn: "SUI",
      tokenOut: "",
      amount: "789",
    }),
    (error) => {
      assert.ok(error instanceof ClawValidationError);
      assert.equal(error.field, "tokenOut");
      return true;
    },
  );

  await evmSigner.swap({
    chain: "base",
    tokenIn: "native",
    tokenOut: "0x0000000000000000000000000000000000000001",
    amountIn: "123",
  });
  await solanaSigner.invoke({
    txPayloadBase64: "AQ==",
    confirmedByUser: true,
  });
  await solanaSigner.swap({
    tokenOut: "USDC",
    amountIn: "456",
    slippageBps: 75,
  });
  await suiSigner.invoke({
    txBytesBase64: "AQ==",
  });
  await suiSigner.swap({
    tokenIn: "SUI",
    tokenOut: "USDC",
    amount: "789",
  });

  const evmSwap = calls.find((call) => call.url === "/api/v1/tx/swap/evm");
  assert.equal("uid" in evmSwap.body, false);
  assert.equal(evmSwap?.body.amount_in_wei, "123");
  assert.equal("amountIn" in evmSwap.body, false);

  const solInvoke = calls.find((call) => call.url === "/api/v1/tx/sol/invoke");
  assert.equal("uid" in solInvoke.body, false);
  assert.equal(solInvoke?.body.tx_payload_base64, "AQ==");
  assert.equal(solInvoke?.body.confirmed_by_user, true);

  const solSwap = calls.find((call) => call.url === "/api/v1/tx/swap/solana");
  assert.equal("uid" in solSwap.body, false);
  assert.equal(solSwap?.body.amount_in_wei, "456");
  assert.equal(solSwap?.body.slippage_bps, 75);

  const suiInvoke = calls.find((call) => call.url === "/api/v1/tx/sui/invoke");
  assert.equal("uid" in suiInvoke.body, false);
  assert.equal(suiInvoke?.body.tx_bytes_base64, "AQ==");

  const suiSwap = calls.find((call) => call.url === "/api/v1/tx/swap/sui");
  assert.equal("uid" in suiSwap.body, false);
  assert.equal(suiSwap?.body.amount_wei, "789");

  process.stdout.write("chain operations unit passed\n");
} finally {
  server.close();
}
