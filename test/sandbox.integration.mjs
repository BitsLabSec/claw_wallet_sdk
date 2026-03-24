/**
 * Integration tests against a running Claw sandbox (default http://127.0.0.1:9000).
 *
 * Run from package root: `npm run test:integration`
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

import { createClawWalletClient } from "../dist/index.js";
import { loadIntegrationConfig } from "./load-integration-config.mjs";

let cfg;

before(() => {
  cfg = loadIntegrationConfig();
});

describe("claw_wallet_sdk vs live sandbox", () => {
  it("GET /health returns ok", async () => {
    const client = createClawWalletClient({
      baseUrl: cfg.baseUrl,
      agentToken: cfg.agentToken || undefined,
    });
    const { data, error, response } = await client.GET("/health", {});
    assert.equal(response.status, 200, `health failed: ${error ?? response.statusText}`);
    assert.ok(data, "expected JSON body");
    assert.equal(data.status, "ok");
  });

  it("GET /api/v1/wallet/status with configured token succeeds", async () => {
    if (!cfg.agentToken) {
      console.log(
        "[skip] no CLAY_AGENT_TOKEN / AGENT_TOKEN in env or .env.clay — cannot assert authenticated status",
      );
      return;
    }
    const client = createClawWalletClient({
      baseUrl: cfg.baseUrl,
      agentToken: cfg.agentToken,
    });
    const { data, error, response } = await client.GET(
      "/api/v1/wallet/status",
      {},
    );
    assert.equal(
      response.status,
      200,
      `wallet/status failed: ${error ?? response.statusText} (loaded env from ${cfg.hadEnvFile ? cfg.envPath : "env vars only"})`,
    );
    assert.ok(data, "expected JSON body");
    assert.ok("status" in data || "gateway_status" in data);
  });

  it("rejects wrong bearer when sandbox enforces AGENT_TOKEN", async () => {
    if (!cfg.agentToken) {
      console.log("[skip] sandbox has no token in config — auth not enforced");
      return;
    }
    const client = createClawWalletClient({
      baseUrl: cfg.baseUrl,
      agentToken: "definitely-not-the-sandbox-token",
    });
    const { response } = await client.GET("/api/v1/wallet/status", {});
    assert.equal(response.status, 401);
  });
});
