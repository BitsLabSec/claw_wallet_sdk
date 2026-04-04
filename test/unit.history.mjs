import assert from "node:assert/strict";
import http from "node:http";

import { ClawSandboxClient } from "../dist/index.js";

const historyRows = [
  {
    chain: "ethereum",
    hash: "0xincoming",
    from: "0xfeedface00000000000000000000000000000001",
    to: "0xabc0000000000000000000000000000000000001",
    amount: "1.25",
    symbol: "ETH",
    contract_address: "native",
    direction: "incoming",
    timestamp: "2026-04-04T00:00:00.000Z",
    status: "success",
  },
  {
    chain: "ethereum",
    hash: "0xoutgoing",
    from: "0xabc0000000000000000000000000000000000001",
    to: "0xfeedface00000000000000000000000000000002",
    amount: "0.5",
    symbol: "ETH",
    contract_address: "native",
    direction: "outgoing",
    timestamp: "2026-04-03T23:59:59.000Z",
    status: "success",
  },
];

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url?.startsWith("/api/v1/wallet/history")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(historyRows));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

await new Promise((resolve) => {
  server.listen(0, "127.0.0.1", resolve);
});

try {
  const address = server.address();
  assert.ok(address && typeof address === "object", "test server did not expose a socket address");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const client = new ClawSandboxClient({
    uid: "unit-history-wallet",
    sandboxUrl: baseUrl,
    sandboxToken: "",
  });

  const history = await client.getHistory({ chain: "ethereum", limit: 2 });
  assert.equal(history.length, 2);
  assert.equal(history[0].direction, "incoming");
  assert.equal(history[1].direction, "outgoing");
  assert.equal(history[0].hash, "0xincoming");
  assert.equal(history[1].hash, "0xoutgoing");
  process.stdout.write("sdk history unit passed\n");
} finally {
  server.close();
}
