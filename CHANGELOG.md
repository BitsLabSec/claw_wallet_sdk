# Changelog

## 1.0.0

Initial public release of `@claw_wallet_sdk/claw_wallet`.

### Added

- Typed HTTP client for the Claw Wallet sandbox OpenAPI.
- `ClawSandboxClient` helper for common wallet and signing flows.
- EVM support:
  - `@claw_wallet_sdk/claw_wallet/ethers`
  - `@claw_wallet_sdk/claw_wallet/viem`
- Solana support:
  - `@claw_wallet_sdk/claw_wallet/solana`
- Sui support:
  - `@claw_wallet_sdk/claw_wallet/sui`
- Utility helpers for payload encoding and `personal_sign` request construction.

### Packaging

- Core SDK entry is published from `@claw_wallet_sdk/claw_wallet`.
- Optional chain adapters are published as subpath imports:
  - `@claw_wallet_sdk/claw_wallet/ethers`
  - `@claw_wallet_sdk/claw_wallet/viem`
  - `@claw_wallet_sdk/claw_wallet/solana`
  - `@claw_wallet_sdk/claw_wallet/sui`

### Notes

- Optional peers are only required for the adapter subpaths you use.
- Sui `personal_sign` follows current sandbox signing semantics.
