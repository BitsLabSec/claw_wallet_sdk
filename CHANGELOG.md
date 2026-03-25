# Changelog

## 1.0.0

Initial public release of `@bitslabsec/claw_wallet_sdk`.

### Added

- Typed HTTP client for the Claw Wallet sandbox OpenAPI.
- `ClawSandboxClient` helper for common wallet and signing flows.
- EVM support:
  - `@bitslabsec/claw_wallet_sdk/ethers`
  - `@bitslabsec/claw_wallet_sdk/viem`
- Solana support:
  - `@bitslabsec/claw_wallet_sdk/solana`
- Sui support:
  - `@bitslabsec/claw_wallet_sdk/sui`
- Utility helpers for payload encoding and `personal_sign` request construction.

### Packaging

- Core SDK entry is published from `@bitslabsec/claw_wallet_sdk`.
- Optional chain adapters are published as subpath imports:
  - `@bitslabsec/claw_wallet_sdk/ethers`
  - `@bitslabsec/claw_wallet_sdk/viem`
  - `@bitslabsec/claw_wallet_sdk/solana`
  - `@bitslabsec/claw_wallet_sdk/sui`

### Notes

- Optional peers are only required for the adapter subpaths you use.
- Sui `personal_sign` follows current sandbox signing semantics.
