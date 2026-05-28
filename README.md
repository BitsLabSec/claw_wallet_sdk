# @claw_wallet_sdk/claw_wallet

TypeScript SDK for the Claw Wallet sandbox.

```bash
npm install @claw_wallet_sdk/claw_wallet
```

## Quick Start

Use `ClawWallet` for new integrations. It keeps wallet, transfer, swap, bridge, policy, and asset APIs in one place.

```ts
import { ClawWallet } from "@claw_wallet_sdk/claw_wallet";

const claw = new ClawWallet({
  sandboxUrl: process.env.CLAY_SANDBOX_URL!,
  token: process.env.CLAY_AGENT_TOKEN,
});

const status = await claw.wallet.status();
const assets = await claw.wallet.assets();

await claw.tx.transfer({
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
const bridgeRequest = {
  fromChainId: "1",
  fromAddress: "0xSourceWallet",
  fromToken: "native",
  amount: "1000000000000000",
  toChainId: "1151111081099710",
  toAddress: "SolanaTargetWallet",
  toToken: "USDC",
};

await claw.bridge.lifi.quote(bridgeRequest);
const result = await claw.bridge.lifi.execute(bridgeRequest);

if (result.final_status_url) {
  await claw.bridge.lifi.getStatus(result.final_status_url);
}
```

Call `await claw.bridge.lifi.tokens(["1", "1151111081099710"])` before quoting when you need the exact supported token address, mint, or coin type.

## Wallet And Transactions

```ts
await claw.wallet.init();
await claw.wallet.status();
await claw.wallet.updatePolicy({ daily_limit_usd: 1000 });

await claw.tx.evm.invoke({
  chain: "base",
  to: "0xContract",
  data: "0x...",
  value: "0",
  confirmedByUser: true,
});

await claw.tx.broadcast({
  chain: "ethereum",
  raw_tx_hex: "0x...",
});
```

`ClawWallet` accepts friendly camelCase fields such as `amountIn`, `tokenOut`, `fromChainId`, and `confirmedByUser`, while still accepting sandbox OpenAPI snake_case fields.

## Errors

```ts
import { ClawSDKError, ClawValidationError } from "@claw_wallet_sdk/claw_wallet";

try {
  await claw.swap.evm({ chain: "base", tokenOut: "USDC", amountIn: "" });
} catch (error) {
  if (error instanceof ClawValidationError) {
    console.log(error.field, error.message);
  } else if (error instanceof ClawSDKError) {
    console.log(error.code, error.status, error.path);
  }
}
```

## Optional Chain Signers

Use subpath imports when your app already works with a chain signer abstraction. Optional peers are only needed for the subpath you import.

```bash
npm install ethers          # @claw_wallet_sdk/claw_wallet/ethers
npm install viem            # @claw_wallet_sdk/claw_wallet/viem
npm install @solana/web3.js # @claw_wallet_sdk/claw_wallet/solana
npm install @mysten/sui     # @claw_wallet_sdk/claw_wallet/sui
```

```ts
import { JsonRpcProvider } from "ethers";
import { ClawEthersSigner } from "@claw_wallet_sdk/claw_wallet/ethers";
import { ClawSolanaSigner } from "@claw_wallet_sdk/claw_wallet/solana";
import { ClawSuiSigner } from "@claw_wallet_sdk/claw_wallet/sui";

const config = {
  sandboxUrl: process.env.CLAY_SANDBOX_URL!,
  sandboxToken: process.env.CLAY_AGENT_TOKEN!,
};

const evm = new ClawEthersSigner({ ...config, chain: "base" }, new JsonRpcProvider(process.env.RPC_URL!));
await evm.swap({ chain: "base", tokenOut: "USDC", amountIn: "1000000" });

const solana = await ClawSolanaSigner.fromSandbox(config);
await solana.invoke({ txPayloadBase64: "..." });

const sui = await ClawSuiSigner.fromSandbox(config);
await sui.swap({ tokenIn: "SUI", tokenOut: "USDC", amount: "1000000000" });
```

## Lower-Level Client

`ClawSandboxClient` and `createClawWalletClient` remain available for advanced or legacy integrations.

```ts
import { ClawSandboxClient, createClawWalletClient } from "@claw_wallet_sdk/claw_wallet";

const sandbox = new ClawSandboxClient({
  sandboxUrl: process.env.CLAY_SANDBOX_URL!,
  sandboxToken: process.env.CLAY_AGENT_TOKEN!,
});

await sandbox.getStatus();
await sandbox.broadcastTransaction({ chain: "ethereum", raw_tx_hex: "0x..." });

const client = createClawWalletClient({
  baseUrl: process.env.CLAY_SANDBOX_URL!,
  agentToken: process.env.CLAY_AGENT_TOKEN,
});

await client.GET("/api/v1/wallet/status", {});
```

The root entry does not import `ethers`, `viem`, `@solana/web3.js`, or `@mysten/sui` at runtime. Use subpath imports for chain adapters.
