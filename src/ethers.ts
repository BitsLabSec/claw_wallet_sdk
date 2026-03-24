import {
  AbstractSigner,
  FetchRequest,
  JsonRpcProvider,
  Provider,
  Signature,
  Transaction,
  TransactionRequest,
  TypedDataDomain,
  TypedDataField,
  hexlify,
  resolveAddress,
  resolveProperties,
  toUtf8Bytes,
  verifyMessage,
} from "ethers";

import { ClawSandboxClient, type ClawSignerConfig } from "./sandbox.js";

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export type ClawSandboxEthersOptions = {
  baseUrl: string;
  agentToken?: string;
  /** Path segment for `/api/rpc/{chainKey}` (default `ethereum`). */
  chainKey?: string;
};

/**
 * Read-only JSON-RPC via Sandbox proxy (`POST /api/rpc/{chainKey}`).
 */
export function createClawSandboxJsonRpcProvider(options: ClawSandboxEthersOptions) {
  const chainKey = options.chainKey ?? "ethereum";
  const url = `${normalizeBaseUrl(options.baseUrl)}/api/rpc/${chainKey}`;
  const req = new FetchRequest(url);
  req.setHeader("Content-Type", "application/json");
  const token = options.agentToken?.trim();
  if (token) req.setHeader("Authorization", `Bearer ${token}`);
  return new JsonRpcProvider(req);
}

/** Recover/check signer address for EVM `personal_sign` (EIP-191). */
export function recoverAddressFromPersonalSignEthers(
  message: string,
  signatureHex: string,
): string {
  return verifyMessage(message, signatureHex);
}

function inferPrimaryType(types: Record<string, Array<TypedDataField>>): string | undefined {
  const candidates = Object.keys(types).filter((name) => name !== "EIP712Domain");
  if (candidates.length <= 1) {
    return candidates[0];
  }

  const referenced = new Set<string>();
  for (const fields of Object.values(types)) {
    for (const field of fields) {
      referenced.add(field.type.replace(/\[\]$/, ""));
    }
  }

  return candidates.find((name) => !referenced.has(name)) ?? candidates[0];
}

function withEip712DomainTypes(
  domain: TypedDataDomain,
  types: Record<string, Array<TypedDataField>>,
): Record<string, Array<TypedDataField>> {
  if (types.EIP712Domain?.length) {
    return types;
  }

  const fields: TypedDataField[] = [];
  if (domain.name != null) fields.push({ name: "name", type: "string" });
  if (domain.version != null) fields.push({ name: "version", type: "string" });
  if (domain.chainId != null) fields.push({ name: "chainId", type: "uint256" });
  if (domain.verifyingContract != null) fields.push({ name: "verifyingContract", type: "address" });
  if (domain.salt != null) fields.push({ name: "salt", type: "bytes32" });

  return {
    EIP712Domain: fields,
    ...types,
  };
}

export class ClawEthersSigner extends AbstractSigner {
  private readonly client: ClawSandboxClient;
  private readonly config: ClawSignerConfig;
  private address: string;

  constructor(config: ClawSignerConfig, provider: Provider | null = null, address = "") {
    super(provider);
    this.client = new ClawSandboxClient(config);
    this.config = config;
    this.address = address;
  }

  async getAddress(): Promise<string> {
    if (this.address) {
      return this.address;
    }

    const status = await this.client.getStatus();
    this.address = status.addresses?.ethereum ?? status.address ?? "";
    if (!this.address) {
      throw new Error("Claw Sandbox status did not include an ethereum address");
    }
    return this.address;
  }

  connect(provider: Provider | null): ClawEthersSigner {
    return new ClawEthersSigner(this.config, provider, this.address);
  }

  async signMessage(message: string | Uint8Array): Promise<string> {
    const payloadHex = typeof message === "string" ? hexlify(toUtf8Bytes(message)) : hexlify(message);
    const res = await this.client.sign({
      chain: "ethereum",
      sign_mode: "personal_sign",
      tx_payload_hex: payloadHex,
    });
    return res.signature_hex ?? "";
  }

  async signTypedData(
    domain: TypedDataDomain,
    types: Record<string, Array<TypedDataField>>,
    value: Record<string, unknown>,
  ): Promise<string> {
    const primaryType = inferPrimaryType(types);
    if (!primaryType) {
      throw new Error("Typed data types must include a primary type");
    }

    const res = await this.client.sign({
      chain: "ethereum",
      sign_mode: "typed_data",
      typed_data: {
        domain,
        types: withEip712DomainTypes(domain, types),
        primaryType,
        message: value,
      },
    });
    return res.signature_hex ?? "";
  }

  async signTransaction(transaction: TransactionRequest): Promise<string> {
    const tx = await resolveProperties(transaction);
    const normalizedTo = tx.to ? await resolveAddress(tx.to, this.provider) : null;
    const normalizedFrom = tx.from ? await resolveAddress(tx.from, this.provider) : undefined;
    const unsigned = Transaction.from({
      ...tx,
      to: normalizedTo,
      from: normalizedFrom,
    } as any);

    const res = await this.client.sign({
      chain: "ethereum",
      sign_mode: "transaction",
      confirmed_by_user: true,
      to: normalizedTo ?? undefined,
      amount_wei: tx.value ? tx.value.toString() : "0",
      data: tx.data ? hexlify(tx.data) : "0x",
      tx_payload_hex: unsigned.unsignedSerialized,
    });

    if (!res.signature_hex) {
      throw new Error("Claw Sandbox did not return a signature");
    }

    unsigned.signature = Signature.from(res.signature_hex);
    return unsigned.serialized;
  }
}
