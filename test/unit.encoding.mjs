/**
 * Pure unit tests for dist/encoding.js - no network, no sandbox.
 * Run: npm run build && node test/unit.encoding.mjs
 */
import assert from "node:assert/strict";

import {
  bytesToHex,
  hexToBytes,
  stripHexPrefix,
  toBase64,
  utf8ToPayloadHex,
} from "../dist/encoding.js";

const orig = new Uint8Array([0, 1, 255, 128, 16]);
const h = bytesToHex(orig);
assert.equal(h, "0x0001ff8010");
assert.deepEqual(hexToBytes(h), orig);

assert.equal(bytesToHex(new Uint8Array([0xab]), false), "ab");
assert.throws(() => hexToBytes("0xabc"), /even/);

assert.equal(stripHexPrefix("0xdead"), "dead");
assert.equal(stripHexPrefix("beef"), "beef");

assert.equal(utf8ToPayloadHex("hi"), "0x6869");
assert.equal(utf8ToPayloadHex("你好"), "0xe4bda0e5a5bd");

const b64 = toBase64(new Uint8Array([1, 2, 3]));
assert.equal(b64, Buffer.from([1, 2, 3]).toString("base64"));

process.stdout.write("unit encoding passed\n");
