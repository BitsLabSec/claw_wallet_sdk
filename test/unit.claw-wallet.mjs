import assert from "node:assert/strict";
import http from "node:http";

import { ClawSDKError, ClawValidationError, ClawWallet } from "../dist/index.js";

const calls = [];

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
  });
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : undefined;
    calls.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      body,
    });

    if (req.url === "/fail/api/v1/wallet/status") {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "sandbox unavailable" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    if (req.url === "/api/v1/wallet/status") {
      res.end(JSON.stringify({ status: "ready", uid: "uid-1" }));
      return;
    }
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
    if (req.url === "/api/v1/tx/bridge/lifi/quote") {
      res.end(JSON.stringify({ is_success: true, amount_in_raw: body.amount }));
      return;
    }
    if (req.url === "/api/v1/tx/broadcast") {
      res.end(JSON.stringify({ chain: body.chain, tx_hash: "0xsent" }));
      return;
    }
    if (req.url?.startsWith("/api/v1/tx/bridge/lifi/tokens")) {
      res.end(JSON.stringify({ ok: true }));
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
  const claw = new ClawWallet({
    sandboxUrl: `http://127.0.0.1:${address.port}/`,
    token: "test-token",
  });

  const status = await claw.wallet.status();
  assert.equal(status.status, "ready");

  await assert.rejects(
    () => claw.transfer({
      chain: "solana",
      to: "recipient",
      amount: "",
    }),
    (error) => {
      assert.ok(error instanceof ClawValidationError);
      assert.equal(error.code, "CLAW_VALIDATION_ERROR");
      assert.equal(error.field, "amount");
      return true;
    },
  );

  await claw.transfer({
    chain: "solana",
    to: "recipient",
    amount: "1000",
    tokenContract: "native",
    confirmedByUser: true,
  });

  await claw.swap.evm({
    chain: "base",
    tokenIn: "native",
    tokenOut: "0x0000000000000000000000000000000000000001",
    amountIn: "123",
    slippageTolerance: 50,
  });

  await claw.bridge.lifi.quote({
    fromChainId: "1",
    fromAddress: "0xfrom",
    fromToken: "native",
    amount: "456",
    toChainId: "1151111081099710",
    toAddress: "sol-to",
    toToken: "USDC",
    viaSolana: true,
  });

  await claw.bridge.lifi.tokens(["1", "56"]);

  const broadcast = await claw.broadcastTransaction({
    chain: "ethereum",
    raw_tx_hex: "0xabc",
  });
  assert.equal(broadcast.tx_hash, "0xsent");

  await claw.transfer({
    uid: "explicit-uid",
    chain: "solana",
    to: "recipient",
    amount: "2000",
  });

  const transferCall = calls.find((call) => call.url === "/api/v1/tx/transfer");
  assert.equal("uid" in transferCall.body, false);
  assert.equal(transferCall?.body.amount_wei, "1000");
  assert.equal(transferCall?.body.token_contract, "native");
  assert.equal(transferCall?.body.confirmed_by_user, true);
  assert.equal("confirmedByUser" in transferCall.body, false);

  const explicitUidTransfer = calls.find(
    (call) => call.url === "/api/v1/tx/transfer" && call.body?.amount_wei === "2000",
  );
  assert.equal(explicitUidTransfer?.body.uid, "explicit-uid");

  const swapCall = calls.find((call) => call.url === "/api/v1/tx/swap/evm");
  assert.equal(swapCall?.authorization, "Bearer test-token");
  assert.equal("uid" in swapCall.body, false);
  assert.equal(swapCall?.body.token_in, "native");
  assert.equal(swapCall?.body.token_out, "0x0000000000000000000000000000000000000001");
  assert.equal(swapCall?.body.amount_in_wei, "123");
  assert.equal(swapCall?.body.slippage_tolerance, 50);
  assert.equal("tokenIn" in swapCall.body, false);

  const bridgeCall = calls.find((call) => call.url === "/api/v1/tx/bridge/lifi/quote");
  assert.equal(bridgeCall?.body.via_solana, true);
  assert.equal(bridgeCall?.body.from_chain_id, "1");
  assert.equal(bridgeCall?.body.to_chain_id, "1151111081099710");
  assert.equal("fromChainId" in bridgeCall.body, false);

  const tokenCall = calls.find((call) => call.url === "/api/v1/tx/bridge/lifi/tokens?chains=1%2C56");
  assert.ok(tokenCall, "expected encoded LI.FI token query");

  const broadcastCall = calls.find((call) => call.url === "/api/v1/tx/broadcast");
  assert.equal("uid" in broadcastCall.body, false);
  assert.equal(broadcastCall?.body.raw_tx_hex, "0xabc");

  const failingClaw = new ClawWallet({
    sandboxUrl: `http://127.0.0.1:${address.port}/fail`,
    token: "test-token",
  });
  await assert.rejects(
    () => failingClaw.wallet.status(),
    (error) => {
      assert.ok(error instanceof ClawSDKError);
      assert.equal(error.code, "CLAW_SANDBOX_ERROR");
      assert.equal(error.status, 500);
      assert.equal(error.path, "/api/v1/wallet/status");
      return true;
    },
  );

  process.stdout.write("claw wallet facade unit passed\n");
} finally {
  server.close();
}
