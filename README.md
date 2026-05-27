# @claw_wallet_sdk/claw_wallet

TypeScript SDK for the Claw Wallet sandbox.

## Install

```bash
npm install @claw_wallet_sdk/claw_wallet
```

The root package is the recommended entry for app integrations. It exposes `ClawWallet`, the typed OpenAPI client, and lightweight helpers without loading optional chain libraries.

## Recommended Usage

```ts
import { ClawWallet } from "@claw_wallet_sdk/claw_wallet";

const claw = new ClawWallet({
  uid: process.env.CLAY_UID!,
  sandboxUrl: process.env.CLAY_SANDBOX_URL!,
  token: process.env.CLAY_AGENT_TOKEN,
});

const status = await claw.wallet.status();
const assets = await claw.wallet.assets();
```

`ClawWallet` groups the common sandbox flows by task:

- `claw.wallet.*`: status, init, unlock, reactivate, backup, import, provision, bind, assets, history, policy
- `claw.tx.*`: sign, broadcast, transfer, EVM/Solana/Sui invoke, Sui Haedal
- `claw.swap.*`: EVM, Solana, and Sui same-chain swaps
- `claw.bridge.lifi.*`: token discovery, quote, execute, and `final_status_url` lookup
- `claw.policy.*` and `claw.assets.*`: focused aliases for common wallet operations

The facade accepts SDK-friendly camelCase fields for newer helpers, such as `amountIn`, `tokenOut`, `slippageTolerance`, `fromChainId`, and `confirmedByUser`, while still accepting the sandbox OpenAPI snake_case fields.

## Wallet

```ts
await claw.wallet.init({ master_pin: "123456" });
await claw.wallet.unlock({ pin: "123456" });
await claw.wallet.reactivate();

const policy = await claw.wallet.policy();
const history = await claw.wallet.history({ chain: "ethereum", limit: 20 });
```

## Transfer

```ts
await claw.transfer({
  chain: "solana",
  to: "recipient-address",
  amount: "1000000",
  tokenContract: "native",
  confirmedByUser: true,
});
```

## Swap

```ts
await claw.swap.evm({
  chain: "base",
  tokenIn: "native",
  tokenOut: "0x0000000000000000000000000000000000000001",
  amountIn: "1000000000000000",
  slippageTolerance: 50,
});

await claw.swap.solana({
  tokenOut: "USDC",
  amountIn: "1000000",
  slippageBps: 75,
});

await claw.swap.sui({
  tokenIn: "SUI",
  tokenOut: "USDC",
  amount: "1000000000",
});
```

## Bridge

```ts
const tokens = await claw.bridge.lifi.tokens(["1", "1151111081099710"]);

const quote = await claw.bridge.lifi.quote({
  fromChainId: "1",
  fromAddress: "0xSourceWallet",
  fromToken: "native",
  amount: "1000000000000000",
  toChainId: "1151111081099710",
  toAddress: "SolanaTargetWallet",
  toToken: "USDC",
});

const bridge = await claw.bridge.lifi.execute({
  fromChainId: "1",
  fromAddress: "0xSourceWallet",
  fromToken: "native",
  amount: "1000000000000000",
  toChainId: "1151111081099710",
  toAddress: "SolanaTargetWallet",
  toToken: "USDC",
});

if (bridge.status === "PENDING" && bridge.final_status_url) {
  const status = await claw.bridge.lifi.getStatus(bridge.final_status_url);
}
```

## Transactions

```ts
await claw.tx.evm.invoke({
  chain: "base",
  to: "0xContract",
  data: "0x...",
  amount_wei: "0",
  confirmedByUser: true,
});

await claw.broadcastTransaction({
  chain: "ethereum",
  raw_tx_hex: "0x...",
});
```

`ClawWallet` extends `ClawSandboxClient`, so historical helper names like `getStatus()`, `getAssets()`, `sign()`, `broadcast()`, `broadcastTransaction()`, and `transfer()` continue to work. Prefer the grouped `claw.wallet.*`, `claw.tx.*`, `claw.swap.*`, and `claw.bridge.*` API for new integrations.

## Typed Client

Use the typed OpenAPI client when you need direct route-level access.

```ts
import { createClawWalletClient } from "@claw_wallet_sdk/claw_wallet";

const client = createClawWalletClient({
  baseUrl: process.env.CLAY_SANDBOX_URL!,
  agentToken: process.env.CLAY_AGENT_TOKEN,
});

const { data, error, response } = await client.GET("/api/v1/wallet/status", {});
```

## Optional Chain Signers

Install optional peers only for the adapters you import:

```bash
npm install ethers          # for @claw_wallet_sdk/claw_wallet/ethers
npm install viem            # for @claw_wallet_sdk/claw_wallet/viem
npm install @solana/web3.js # for @claw_wallet_sdk/claw_wallet/solana
npm install @mysten/sui     # for @claw_wallet_sdk/claw_wallet/sui
```

These are useful when the integration is already written around a chain signer abstraction.

```ts
import { JsonRpcProvider } from "ethers";
import { ClawEthersSigner } from "@claw_wallet_sdk/claw_wallet/ethers";

const signer = new ClawEthersSigner(
  {
    uid: process.env.CLAY_UID!,
    sandboxUrl: process.env.CLAY_SANDBOX_URL!,
    sandboxToken: process.env.CLAY_AGENT_TOKEN!,
    chain: "base",
  },
  new JsonRpcProvider(process.env.RPC_URL!),
);

await signer.swap({
  chain: "base",
  tokenIn: "native",
  tokenOut: "0x0000000000000000000000000000000000000001",
  amountIn: "1000000000000000",
});
```

```ts
import { ClawSolanaSigner } from "@claw_wallet_sdk/claw_wallet/solana";

const signer = await ClawSolanaSigner.fromSandbox({
  uid: process.env.CLAY_UID!,
  sandboxUrl: process.env.CLAY_SANDBOX_URL!,
  sandboxToken: process.env.CLAY_AGENT_TOKEN!,
});

await signer.swap({
  tokenOut: "USDC",
  amountIn: "1000000",
});
```

```ts
import { ClawSuiSigner } from "@claw_wallet_sdk/claw_wallet/sui";

const signer = await ClawSuiSigner.fromSandbox({
  uid: process.env.CLAY_UID!,
  sandboxUrl: process.env.CLAY_SANDBOX_URL!,
  sandboxToken: process.env.CLAY_AGENT_TOKEN!,
});

await signer.invoke({
  txBytesBase64: "...",
});
```

## Lower-Level Sandbox Client

`ClawSandboxClient` remains available for older integrations and advanced route grouping.

```ts
import { ClawSandboxClient } from "@claw_wallet_sdk/claw_wallet";

const sandbox = new ClawSandboxClient({
  uid: process.env.CLAY_UID!,
  sandboxUrl: process.env.CLAY_SANDBOX_URL!,
  sandboxToken: process.env.CLAY_AGENT_TOKEN!,
});

const status = await sandbox.getStatus();
await sandbox.reactivateWallet();
await sandbox.updateLocalPolicy({ daily_limit_usd: 1000 });
```

## Import Boundaries

```ts
import { ClawWallet, ClawSandboxClient, createClawWalletClient } from "@claw_wallet_sdk/claw_wallet";
import { ClawEthersSigner } from "@claw_wallet_sdk/claw_wallet/ethers";
import { createClawAccountFromSandbox } from "@claw_wallet_sdk/claw_wallet/viem";
import { ClawSolanaSigner } from "@claw_wallet_sdk/claw_wallet/solana";
import { ClawSuiSigner } from "@claw_wallet_sdk/claw_wallet/sui";
```

The root entry does not import `ethers`, `viem`, `@solana/web3.js`, or `@mysten/sui` at runtime. Use subpath imports for chain adapters.

## Sui Personal Sign Semantics

The sandbox currently uses a Claw-specific verification flow for Sui `personal_sign`:

- if the provided message bytes do not already start with the Sui personal-message intent prefix, the sandbox prepends `0x03 0x00 0x00`
- it computes `blake2b-256` over that prefixed payload
- it signs the digest with the wallet Ed25519 key
- the SDK serializes the returned signature as `flag || rawSignature || rawPublicKey`, where `flag=0x00` for Ed25519

For Sui transaction bytes, the sandbox signs `blake2b-256(txBytes)` without adding the `personal_sign` intent prefix.
