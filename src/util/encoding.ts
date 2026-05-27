/** UTF-8 string to `0x` hex (for sandbox `tx_payload_hex` on EVM personal_sign). */
export function utf8ToPayloadHex(message: string): `0x${string}` {
  return bytesToHex(new TextEncoder().encode(message)) as `0x${string}`;
}

export function stripHexPrefix(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}

export function bytesToHex(bytes: Uint8Array, prefix = true): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return prefix ? `0x${hex}` : hex;
}

export function hexToBytes(hex: string): Uint8Array {
  const normalized = stripHexPrefix(hex);
  if (normalized.length % 2 !== 0) {
    throw new Error("Hex payload must have an even number of characters");
  }

  const out = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    out[i / 2] = Number.parseInt(normalized.slice(i, i + 2), 16);
  }
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
