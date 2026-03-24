# claw_wallet_sdk

TypeScript SDK for the Claw Wallet sandbox.

This package provides:

- a typed HTTP client for the live sandbox OpenAPI
- signer and account adapters for `ethers`, `viem`, `@solana/web3.js`, and `@mysten/sui`

## Install

```bash
npm install claw_wallet_sdk
```

Install optional peers **only for the adapters you import**:

```bash
npm install ethers          # for `claw_wallet_sdk/ethers`
npm install viem            # for `claw_wallet_sdk/viem`
npm install @solana/web3.js # for `claw_wallet_sdk/solana`
npm install @mysten/sui     # for `claw_wallet_sdk/sui`
```

The main entry (`claw_wallet_sdk`) only loads `openapi-fetch`; it does **not** pull viem/ethers/Solana/Sui at runtime.

## Import boundaries

Use the root entry only for core SDK functionality:

```ts
import {
  createClawWalletClient,
  ClawSandboxClient,
  buildPersonalSignBody,
} from "claw_wallet_sdk";
```

Use subpath imports for chain adapters:

```ts
import { ClawEthersSigner } from "claw_wallet_sdk/ethers";
import { createClawAccountFromSandbox } from "claw_wallet_sdk/viem";
import { ClawSolanaSigner } from "claw_wallet_sdk/solana";
import { ClawSuiSigner } from "claw_wallet_sdk/sui";
```

This is an intentional breaking change from earlier in-repo revisions that re-exported adapters from the root entry.

## Core client

```ts
import { createClawWalletClient } from "claw_wallet_sdk";

const client = createClawWalletClient({
  baseUrl: process.env.CLAY_SANDBOX_URL!,
  agentToken: process.env.CLAY_AGENT_TOKEN,
});

const { data } = await client.GET("/api/v1/wallet/status", {});
```

## Sandbox helper client

```ts
import { ClawSandboxClient } from "claw_wallet_sdk";

const sandbox = new ClawSandboxClient({
  uid: process.env.CLAY_UID!,
  sandboxUrl: process.env.CLAY_SANDBOX_URL!,
  sandboxToken: process.env.CLAY_AGENT_TOKEN!,
});

const status = await sandbox.getStatus();
const ready = await sandbox.reactivateWallet();
const policy = await sandbox.getLocalPolicy();
const assets = await sandbox.getAssets();
const history = await sandbox.getHistory({ chain: "ethereum", limit: 20 });
await sandbox.refreshWallet();
```

High-frequency helper methods currently include:

- `getStatus()`
- `initWallet()`
- `unlockWallet()`
- `reactivateWallet()`
- `refreshWallet()`
- `getAssets()`
- `getHistory()`
- `getLocalPolicy()`
- `sign()`
- `broadcast()`
- `transfer()`

## Wallet lifecycle

```ts
import { ClawSandboxClient } from "claw_wallet_sdk";

const sandbox = new ClawSandboxClient({
  uid: process.env.CLAY_UID!,
  sandboxUrl: process.env.CLAY_SANDBOX_URL!,
  sandboxToken: process.env.CLAY_AGENT_TOKEN!,
});

await sandbox.initWallet({ master_pin: "123456" });

// For provisioned/imported wallets that require a PIN:
await sandbox.unlockWallet({ pin: "123456" });

// For locally initialized wallets with a persisted local SEK:
await sandbox.reactivateWallet();
```

## Ethers signer

```ts
import { JsonRpcProvider } from "ethers";
import { ClawEthersSigner } from "claw_wallet_sdk/ethers";

const signer = new ClawEthersSigner(
  {
    uid: process.env.CLAY_UID!,
    sandboxUrl: process.env.CLAY_SANDBOX_URL!,
    sandboxToken: process.env.CLAY_AGENT_TOKEN!,
  },
  new JsonRpcProvider(process.env.RPC_URL!),
);
```

## Viem account

```ts
import { createClawAccountFromSandbox } from "claw_wallet_sdk/viem";

const account = await createClawAccountFromSandbox({
  uid: process.env.CLAY_UID!,
  sandboxUrl: process.env.CLAY_SANDBOX_URL!,
  sandboxToken: process.env.CLAY_AGENT_TOKEN!,
});
```

## Solana signer

```ts
import { ClawSolanaSigner } from "claw_wallet_sdk/solana";

const signer = await ClawSolanaSigner.fromSandbox({
  uid: process.env.CLAY_UID!,
  sandboxUrl: process.env.CLAY_SANDBOX_URL!,
  sandboxToken: process.env.CLAY_AGENT_TOKEN!,
});

const signed = await signer.signMessage(new Uint8Array([1, 2, 3]));
```

## Sui signer

```ts
import { ClawSuiSigner } from "claw_wallet_sdk/sui";

const signer = await ClawSuiSigner.fromSandbox({
  uid: process.env.CLAY_UID!,
  sandboxUrl: process.env.CLAY_SANDBOX_URL!,
  sandboxToken: process.env.CLAY_AGENT_TOKEN!,
});

const signed = await signer.signPersonalMessage(new Uint8Array([1, 2, 3]));
```

### Sui `personal_sign` sandbox semantics

The sandbox currently uses a Claw-specific verification flow for Sui `personal_sign`:

- if the provided message bytes do not already start with the Sui personal-message intent prefix, the sandbox prepends `0x03 0x00 0x00`
- it computes `blake2b-256` over that prefixed payload
- it signs the digest with the wallet's Ed25519 key
- the SDK serializes the returned signature as `flag || rawSignature || rawPublicKey`, where `flag=0x00` for Ed25519

That means `ClawSuiSigner.signPersonalMessage()` is aligned with sandbox behavior, not with every generic Mysten helper's default assumptions for plain message verification.

For Sui transaction bytes, the sandbox signs `blake2b-256(txBytes)` without adding the `personal_sign` intent prefix.

## Verifying packaging locally

After `npm run build`, run `npm run test:pack-consumer` to simulate `npm pack` + a clean consumer project: core import with **no** viem/ethers/Solana/Sui installed, then each subpath after installing the matching peer.

## Migration

If existing code imports adapters from the root entry, change them to subpath imports:

```ts
// before
import { ClawEthersSigner, createClawAccountFromSandbox } from "claw_wallet_sdk";

// after
import { ClawEthersSigner } from "claw_wallet_sdk/ethers";
import { createClawAccountFromSandbox } from "claw_wallet_sdk/viem";
```

## Notes

- The sandbox still writes `CLAY_*` environment variables today. That is a sandbox compatibility detail, not SDK naming guidance.
- Public API naming in this package should use `claw`, not `clay`.
- The sandbox must already be initialized and unlocked before signing flows succeed.
