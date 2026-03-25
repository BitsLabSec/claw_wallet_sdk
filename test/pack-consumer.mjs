/**
 * Simulates a published tarball: minimal install must resolve `@bitslabsec/claw_wallet_sdk`
 * without pulling viem/ethers/Solana/Sui unless the user imports those subpaths.
 *
 * Run: `npm run build && node test/pack-consumer.mjs`
 */
import { execSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("..", import.meta.url));

function run(cmd, cwd = pkgRoot) {
  execSync(cmd, { stdio: "inherit", cwd, shell: true });
}

const tmp = mkdtempSync(join(tmpdir(), "claw-sdk-pack-"));

try {
  const packDest = join(tmp, "pack");
  mkdirSync(packDest, { recursive: true });

  run(`npm pack --pack-destination "${packDest}"`);
  const tgz = readdirSync(packDest).find((f) => f.endsWith(".tgz"));
  if (!tgz) throw new Error("npm pack did not produce a .tgz");

  const tarball = join(packDest, tgz);
  const consumer = join(tmp, "consumer");
  mkdirSync(consumer);

  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ name: "sdk-consumer-smoke", type: "module", private: true }),
  );

  run(`npm install "${tarball}"`, consumer);

  writeFileSync(
    join(consumer, "core.mjs"),
    `import { createClawWalletClient, ClawSandboxClient } from "@bitslabsec/claw_wallet_sdk";
if (typeof createClawWalletClient !== "function") throw new Error("createClawWalletClient");
if (typeof ClawSandboxClient !== "function") throw new Error("ClawSandboxClient");
console.log("core-import-ok");
`,
  );
  run("node core.mjs", consumer);

  run("npm install viem@^2", consumer);
  writeFileSync(
    join(consumer, "viem.mjs"),
    `import { createClawSandboxPublicClient } from "@bitslabsec/claw_wallet_sdk/viem";
if (typeof createClawSandboxPublicClient !== "function") throw new Error("viem export");
console.log("viem-subpath-ok");
`,
  );
  run("node viem.mjs", consumer);

  run("npm install ethers@^6", consumer);
  writeFileSync(
    join(consumer, "ethers.mjs"),
    `import { createClawSandboxJsonRpcProvider } from "@bitslabsec/claw_wallet_sdk/ethers";
if (typeof createClawSandboxJsonRpcProvider !== "function") throw new Error("ethers export");
console.log("ethers-subpath-ok");
`,
  );
  run("node ethers.mjs", consumer);

  run("npm install @solana/web3.js@^1", consumer);
  writeFileSync(
    join(consumer, "solana.mjs"),
    `import { ClawSolanaSigner } from "@bitslabsec/claw_wallet_sdk/solana";
if (typeof ClawSolanaSigner !== "function") throw new Error("solana export");
console.log("solana-subpath-ok");
`,
  );
  run("node solana.mjs", consumer);

  run("npm install @mysten/sui@^2", consumer);
  writeFileSync(
    join(consumer, "sui.mjs"),
    `import { ClawSuiSigner } from "@bitslabsec/claw_wallet_sdk/sui";
if (typeof ClawSuiSigner !== "function") throw new Error("sui export");
console.log("sui-subpath-ok");
`,
  );
  run("node sui.mjs", consumer);

  console.log("pack consumer smoke passed");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
