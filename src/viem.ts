import {
  type TypedData,
  type TypedDataDomain,
  type Address,
  type Chain,
  type Hex,
  type TransactionSerializable,
  createPublicClient,
  http,
  isHex,
  recoverMessageAddress,
  serializeTransaction,
  toHex,
} from "viem";
import { type LocalAccount, toAccount } from "viem/accounts";
import { mainnet } from "viem/chains";

import {
  clawChainToChainId,
  resolveClawEvmChain,
} from "./evm-chain.js";
import { ClawSandboxClient, type ClawSignerConfig } from "./sandbox.js";

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export type ClawSandboxViemOptions = {
  baseUrl: string;
  agentToken?: string;
  /** Path segment for `/api/rpc/{chainKey}` (default `ethereum`). */
  chainKey?: string;
  /** Viem chain metadata (default `mainnet`). */
  chain?: Chain;
};

/**
 * Read-only JSON-RPC via Sandbox proxy (`POST /api/rpc/{chainKey}`), e.g. `eth_blockNumber`.
 */
export function createClawSandboxPublicClient(options: ClawSandboxViemOptions) {
  const chainKey = options.chainKey ?? "ethereum";
  const chain = options.chain ?? mainnet;
  const url = `${normalizeBaseUrl(options.baseUrl)}/api/rpc/${chainKey}`;
  const token = options.agentToken?.trim();
  return createPublicClient({
    chain,
    transport: http(url, {
      fetchOptions: token
        ? { headers: { Authorization: `Bearer ${token}` } }
        : {},
    }),
  });
}

/**
 * Recover signer address from an EVM `personal_sign` signature (EIP-191), same hashing as Sandbox.
 */
export async function recoverEvmPersonalSignAddress(
  message: string,
  signatureHex: string,
): Promise<`0x${string}`> {
  return recoverMessageAddress({
    message,
    signature: signatureHex as Hex,
  });
}

type ViemMessage = string | Uint8Array | { raw: string | Uint8Array };

function toMessageHex(message: ViemMessage): Hex {
  if (typeof message === "string") {
    return (isHex(message) ? message : toHex(message)) as Hex;
  }

  if (message instanceof Uint8Array) {
    return toHex(message) as Hex;
  }

  const raw = message.raw;
  return (typeof raw === "string" ? (isHex(raw) ? raw : toHex(raw)) : toHex(raw)) as Hex;
}

function withEip712DomainTypes(
  domain: TypedDataDomain | undefined,
  types: TypedData,
): TypedData {
  if (!domain || (types as Record<string, unknown>).EIP712Domain) {
    return types;
  }

  const fields = [];
  if (domain.name != null) fields.push({ name: "name", type: "string" });
  if (domain.version != null) fields.push({ name: "version", type: "string" });
  if (domain.chainId != null) fields.push({ name: "chainId", type: "uint256" });
  if (domain.verifyingContract != null) fields.push({ name: "verifyingContract", type: "address" });
  if (domain.salt != null) fields.push({ name: "salt", type: "bytes32" });

  return {
    EIP712Domain: fields,
    ...types,
  } as unknown as TypedData;
}

export function createClawAccount(config: ClawSignerConfig, address: Address): LocalAccount {
  const client = new ClawSandboxClient(config);

  return toAccount({
    address,
    async sign({ hash }: { hash: Hex }) {
      const res = await client.sign({
        chain: resolveClawEvmChain(config.chain),
        sign_mode: "raw_hash",
        tx_payload_hex: hash,
      });
      return res.signature_hex as Hex;
    },
    async signMessage({ message }: { message: ViemMessage }) {
      const res = await client.sign({
        chain: resolveClawEvmChain(config.chain),
        sign_mode: "personal_sign",
        tx_payload_hex: toMessageHex(message),
      });
      return res.signature_hex as Hex;
    },
    async signTransaction(transaction: TransactionSerializable) {
      const configuredChainId = clawChainToChainId(config.chain);
      const chainId = transaction.chainId != null
        ? Number(transaction.chainId)
        : configuredChainId != null
          ? Number(configuredChainId)
          : Number.NaN;
      if (!Number.isFinite(chainId) || chainId <= 0) {
        throw new Error(
          "Claw viem account requires transaction.chainId or a known config.chain before signing",
        );
      }
      const txWithChainId = { ...transaction, chainId } as TransactionSerializable;
      const unsignedTx = serializeTransaction(txWithChainId);
      const res = await client.sign({
        chain: resolveClawEvmChain(config.chain, chainId),
        sign_mode: "transaction",
        confirmed_by_user: true,
        tx_payload_hex: unsignedTx,
        to: txWithChainId.to ?? undefined,
        amount_wei: txWithChainId.value ? txWithChainId.value.toString() : "0",
        data: txWithChainId.data ?? "0x",
      });

      const signature = res.signature_hex;
      if (!signature) {
        throw new Error("Claw Sandbox did not return a signature");
      }
      const r = `0x${signature.slice(2, 66)}` as Hex;
      const s = `0x${signature.slice(66, 130)}` as Hex;
      const yParity = Number.parseInt(signature.slice(130, 132), 16) as 0 | 1;

      return serializeTransaction(txWithChainId, { r, s, yParity });
    },
    async signTypedData(typedData: Record<string, unknown>) {
      const normalized = typedData as {
        domain?: TypedDataDomain;
        types?: TypedData;
      };
      const res = await client.sign({
        chain: resolveClawEvmChain(config.chain),
        sign_mode: "typed_data",
        typed_data: {
          ...typedData,
          types: withEip712DomainTypes(normalized.domain, normalized.types ?? {}),
        },
      });
      return res.signature_hex as Hex;
    },
  });
}

export async function createClawAccountFromSandbox(config: ClawSignerConfig): Promise<LocalAccount> {
  const client = new ClawSandboxClient(config);
  const address = (await client.getRequiredAddress("ethereum")) as Address;
  return createClawAccount(config, address);
}
