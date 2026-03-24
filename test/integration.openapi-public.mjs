/**
 * Routes that are not wrapped with auth() - no Bearer required.
 * Only needs a reachable CLAY_SANDBOX_URL.
 */
import assert from "node:assert/strict";

import { loadIntegrationConfig } from "./load-integration-config.mjs";

const cfg = loadIntegrationConfig();
if (!cfg.baseUrl) {
  process.stdout.write("openapi public skipped: no base url\n");
  process.exit(0);
}

const healthRes = await fetch(`${cfg.baseUrl}/health`);
assert.equal(healthRes.status, 200);
const health = await healthRes.json();
assert.equal(health.status, "ok");

const openapiRes = await fetch(`${cfg.baseUrl}/openapi.yaml`);
assert.equal(openapiRes.status, 200);
const text = await openapiRes.text();
assert.match(text, /openapi:\s*3/i);
assert.match(text, /\/api\/v1\/wallet\/status/);

process.stdout.write("openapi public passed\n");
