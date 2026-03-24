import { Buffer } from "buffer";

import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

import { bytesToHex, hexToBytes } from "./encoding.js";
import { ClawSandboxClient, type ClawSignerConfig } from "./sandbox.js";

export type ClawSolanaTransaction = Transaction | VersionedTransaction;

function isVersionedTransaction(tx: ClawSolanaTransaction): tx is VersionedTransaction {
  return tx instanceof VersionedTransaction;
}

function serializeTransactionMessage(tx: ClawSolanaTransaction): Uint8Array {
  return isVersionedTransaction(tx) ? tx.message.serialize() : tx.serializeMessage();
}

function attachSignature(
  tx: ClawSolanaTransaction,
  publicKey: PublicKey,
  signature: Uint8Array,
): ClawSolanaTransaction {
  if (isVersionedTransaction(tx)) {
    tx.addSignature(publicKey, signature);
    return tx;
  }

  tx.addSignature(publicKey, Buffer.from(signature));
  return tx;
}

export class ClawSolanaSigner {
  readonly publicKey: PublicKey;
  private readonly client: ClawSandboxClient;

  constructor(config: ClawSignerConfig, publicKey: string | PublicKey) {
    this.client = new ClawSandboxClient(config);
    this.publicKey = typeof publicKey === "string" ? new PublicKey(publicKey) : publicKey;
  }

  static async fromSandbox(config: ClawSignerConfig): Promise<ClawSolanaSigner> {
    const client = new ClawSandboxClient(config);
    const address = await client.getRequiredAddress("solana");
    return new ClawSolanaSigner(config, address);
  }

  getPublicKey(): PublicKey {
    return this.publicKey;
  }

  async signTransaction<T extends ClawSolanaTransaction>(transaction: T): Promise<T> {
    const res = await this.client.sign({
      chain: "solana",
      sign_mode: "transaction",
      amount_wei: "0",
      data: "0x",
      tx_payload_hex: bytesToHex(serializeTransactionMessage(transaction)),
    });

    if (!res.signature_hex) {
      throw new Error("Claw Sandbox did not return a signature");
    }

    return attachSignature(transaction, this.publicKey, hexToBytes(res.signature_hex)) as T;
  }

  async signAllTransactions<T extends ClawSolanaTransaction>(transactions: readonly T[]): Promise<T[]> {
    return Promise.all(transactions.map((transaction) => this.signTransaction(transaction)));
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    const res = await this.client.sign({
      chain: "solana",
      sign_mode: "personal_sign",
      amount_wei: "0",
      data: "0x",
      tx_payload_hex: bytesToHex(message),
    });

    if (!res.signature_hex) {
      throw new Error("Claw Sandbox did not return a signature");
    }

    return hexToBytes(res.signature_hex);
  }

  toKeyPairSigner() {
    return {
      address: this.publicKey.toBase58(),
      publicKey: this.publicKey.toBytes(),
      signMessage: (message: Uint8Array) => this.signMessage(message),
      signTransaction: <T extends ClawSolanaTransaction>(transaction: T) => this.signTransaction(transaction),
      signTransactions: <T extends ClawSolanaTransaction>(transactions: readonly T[]) =>
        this.signAllTransactions(transactions),
    };
  }
}
