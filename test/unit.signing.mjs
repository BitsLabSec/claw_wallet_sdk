/**
 * Pure unit tests for buildPersonalSignBody - no network.
 * Run: npm run build && node test/unit.signing.mjs
 */
import assert from "node:assert/strict";

import { buildPersonalSignBody } from "../dist/signing.js";

const body = buildPersonalSignBody({
  chain: "ethereum",
  uid: "u1",
  message: "claw ok",
});
assert.equal(body.chain, "ethereum");
assert.equal(body.sign_mode, "personal_sign");
assert.equal(body.uid, "u1");
assert.equal(body.tx_payload_hex, "0x636c6177206f6b");
assert.equal(body.amount_wei, "0");
assert.equal(body.data, "0x");
assert.equal(body.confirmed_by_user, true);

const bodyFalse = buildPersonalSignBody({
  chain: "base",
  uid: "x",
  message: "m",
  confirmed_by_user: false,
});
assert.equal(bodyFalse.confirmed_by_user, false);

process.stdout.write("unit signing passed\n");
