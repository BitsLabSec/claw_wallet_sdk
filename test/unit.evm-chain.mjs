import assert from "node:assert/strict";

import {
  chainIdToClawChain,
  clawChainToChainId,
  resolveClawEvmChain,
} from "../dist/evm-chain.js";

assert.equal(clawChainToChainId("kite"), 2366n);
assert.equal(chainIdToClawChain(2366n), "kite");
assert.equal(resolveClawEvmChain("kite"), "kite");
assert.equal(resolveClawEvmChain(undefined, 2366n), "kite");

assert.equal(clawChainToChainId("0g"), 16661n);
assert.equal(chainIdToClawChain(16661n), "0g");

assert.equal(clawChainToChainId("monad"), 143n);
assert.equal(chainIdToClawChain(143n), "monad");

process.stdout.write("unit evm chain passed\n");
