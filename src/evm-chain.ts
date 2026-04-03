const CLAW_EVM_CHAIN_ID_ENTRIES = [
  ["ethereum", 1n],
  ["optimism", 10n],
  ["bsc", 56n],
  ["polygon", 137n],
  ["zksync", 324n],
  ["base", 8453n],
  ["arbitrum", 42161n],
  ["avalanche", 43114n],
  ["linea", 59144n],
] as const;

const CLAW_CHAIN_ID_BY_KEY = new Map<string, bigint>(CLAW_EVM_CHAIN_ID_ENTRIES);
const CLAW_CHAIN_KEY_BY_ID = new Map<string, string>(
  CLAW_EVM_CHAIN_ID_ENTRIES.map(([chainKey, chainId]) => [chainId.toString(), chainKey]),
);

export function normalizeClawEvmChain(chain?: string | null): string | undefined {
  const normalized = chain?.trim().toLowerCase();
  return normalized || undefined;
}

export function clawChainToChainId(chain?: string | null): bigint | undefined {
  const normalized = normalizeClawEvmChain(chain);
  if (!normalized) {
    return undefined;
  }
  return CLAW_CHAIN_ID_BY_KEY.get(normalized);
}

export function chainIdToClawChain(chainId?: bigint | number | null): string | undefined {
  if (chainId == null) {
    return undefined;
  }
  return CLAW_CHAIN_KEY_BY_ID.get(BigInt(chainId).toString());
}

export function resolveClawEvmChain(
  preferredChain?: string | null,
  chainId?: bigint | number | null,
): string {
  return normalizeClawEvmChain(preferredChain) ?? chainIdToClawChain(chainId) ?? "ethereum";
}
