import type { ClawOperationClient, Schema } from "../util/operation-utils.js";
import { coalesce, errorText, withUid, type ClawInvokeResult } from "../util/operation-utils.js";

export type ClawSuiInvokeRequest = Omit<Schema<"SuiTxBytesExecuteRequest">, "tx_bytes_base64" | "tx_bytes_hex"> & {
  tx_bytes_base64?: string;
  txBytesBase64?: string;
  tx_bytes_hex?: string;
  txBytesHex?: string;
};

export type ClawSuiHaedalRequest = Schema<"HaedalOptionedRequest">;
export type ClawSuiTxResponse = Schema<"SuiTxResponse">;

export type ClawSuiSwapRequest = Omit<Schema<"CetusSwapRequest">, "token_in" | "token_out" | "amount_wei"> & {
  token_in?: string;
  tokenIn?: string;
  token_out?: string;
  tokenOut?: string;
  amount_wei?: string;
  amount?: string;
};

export type ClawSuiSwapResponse = Schema<"CetusSwapResponse">;

export async function invokeSui(
  client: ClawOperationClient,
  request: ClawSuiInvokeRequest,
): Promise<ClawInvokeResult> {
  const {
    txBytesBase64: _txBytesBase64,
    txBytesHex: _txBytesHex,
    ...rest
  } = request;
  const { data, error, response } = await client.client.POST("/api/v1/tx/sui/invoke", {
    body: {
      ...withUid(rest, client.config.uid),
      tx_bytes_base64: coalesce(request.tx_bytes_base64, request.txBytesBase64),
      tx_bytes_hex: coalesce(request.tx_bytes_hex, request.txBytesHex),
    },
  });
  if (!response.ok || !data) {
    throw new Error(`Failed to invoke Sui transaction (${response.status}): ${errorText(error, response)}`);
  }
  return data;
}

export async function invokeSuiHaedal(
  client: ClawOperationClient,
  request: ClawSuiHaedalRequest,
): Promise<ClawSuiTxResponse> {
  const { data, error, response } = await client.client.POST("/api/v1/tx/sui/haedal", {
    body: withUid(request, client.config.uid),
  });
  if (!response.ok || !data) {
    throw new Error(`Failed to invoke Sui Haedal action (${response.status}): ${errorText(error, response)}`);
  }
  return data;
}

export async function swapSui(
  client: ClawOperationClient,
  request: ClawSuiSwapRequest,
): Promise<ClawSuiSwapResponse> {
  const {
    tokenIn: _tokenIn,
    tokenOut: _tokenOut,
    amount: _amount,
    ...rest
  } = request;
  const { data, error, response } = await client.client.POST("/api/v1/tx/swap/sui", {
    body: {
      ...withUid(rest, client.config.uid),
      token_in: coalesce(request.token_in, request.tokenIn) ?? "",
      token_out: coalesce(request.token_out, request.tokenOut) ?? "",
      amount_wei: coalesce(request.amount_wei, request.amount) ?? "",
    },
  });
  if (!response.ok || !data) {
    throw new Error(`Failed to swap Sui assets (${response.status}): ${errorText(error, response)}`);
  }
  return data;
}
