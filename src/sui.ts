import type { SignatureWithBytes } from "@mysten/sui/cryptography";

import { bytesToHex, hexToBytes, toBase64 } from "./encoding.js";
import { ClawSandboxClient, type ClawSignerConfig } from "./sandbox.js";

function toSerializedSuiSignature(rawSignatureHex: string, publicKeyHex?: string): string {
  if (!publicKeyHex) {
    throw new Error("Claw Sandbox did not return the Sui public key needed to serialize the signature");
  }

  const signature = hexToBytes(rawSignatureHex);
  const publicKey = hexToBytes(publicKeyHex);
  const serialized = new Uint8Array(1 + signature.length + publicKey.length);
  serialized[0] = 0x00;
  serialized.set(signature, 1);
  serialized.set(publicKey, 1 + signature.length);
  return toBase64(serialized);
}

export class ClawSuiSigner {
  private readonly client: ClawSandboxClient;
  private readonly address: string;

  constructor(config: ClawSignerConfig, address: string) {
    this.client = new ClawSandboxClient(config);
    this.address = address;
  }

  static async fromSandbox(config: ClawSignerConfig): Promise<ClawSuiSigner> {
    const client = new ClawSandboxClient(config);
    const address = await client.getRequiredAddress("sui");
    return new ClawSuiSigner(config, address);
  }

  async getAddress(): Promise<string> {
    return this.address;
  }

  async signTransactionBlock(bytes: Uint8Array): Promise<SignatureWithBytes> {
    const res = await this.client.sign({
      chain: "sui",
      sign_mode: "transaction",
      amount_wei: "0",
      data: "0x",
      tx_payload_hex: bytesToHex(bytes),
    });

    if (!res.signature_hex) {
      throw new Error("Claw Sandbox did not return a signature");
    }

    return {
      bytes: toBase64(bytes),
      signature: toSerializedSuiSignature(res.signature_hex, res.from),
    };
  }

  async signPersonalMessage(bytes: Uint8Array): Promise<SignatureWithBytes> {
    const res = await this.client.sign({
      chain: "sui",
      sign_mode: "personal_sign",
      amount_wei: "0",
      data: "0x",
      tx_payload_hex: bytesToHex(bytes),
    });

    if (!res.signature_hex) {
      throw new Error("Claw Sandbox did not return a signature");
    }

    return {
      bytes: toBase64(bytes),
      signature: toSerializedSuiSignature(res.signature_hex, res.from),
    };
  }
}
