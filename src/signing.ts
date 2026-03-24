import { utf8ToPayloadHex } from "./encoding.js";

export type PersonalSignRequestInput = {
  chain: string;
  uid: string;
  /** Human-readable text; must pass Sandbox strict plain-text rules when enabled. */
  message: string;
  confirmed_by_user?: boolean;
};

/** JSON body for `POST /api/v1/tx/sign` with `sign_mode: personal_sign`. */
export function buildPersonalSignBody(input: PersonalSignRequestInput) {
  return {
    chain: input.chain,
    sign_mode: "personal_sign" as const,
    uid: input.uid,
    tx_payload_hex: utf8ToPayloadHex(input.message),
    amount_wei: "0",
    data: "0x",
    confirmed_by_user: input.confirmed_by_user ?? true,
  };
}
