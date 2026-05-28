import type { ClawOperationClient, Schema } from "../util/operation-utils.js";
import { coalesce, createSandboxError, withUid, type ClawInvokeResult } from "../util/operation-utils.js";
import { requireNonEmpty, requireOneOf } from "../util/validation.js";

export type ClawSuiInvokeRequest = Omit<Schema<"SuiTxBytesExecuteRequest">, "tx_bytes_base64" | "tx_bytes_hex"> & {
  tx_bytes_base64?: string;
  txBytesBase64?: string;
  tx_bytes_hex?: string;
  txBytesHex?: string;
};

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
  const txBytes = request.txBytes;
  const txBytesBase64 = coalesce(request.tx_bytes_base64, request.txBytesBase64);
  const txBytesHex = coalesce(request.tx_bytes_hex, request.txBytesHex);
  requireOneOf(
    [
      ["txBytes", txBytes],
      ["txBytesBase64", txBytesBase64],
      ["txBytesHex", txBytesHex],
    ],
    "invokeSui",
  );
  const { data, error, response } = await client.client.POST("/api/v1/tx/sui/invoke", {
    body: {
      ...withUid(rest, client.config.uid),
      txBytes,
      tx_bytes_base64: txBytesBase64,
      tx_bytes_hex: txBytesHex,
    },
  });
  if (!response.ok || !data) {
    throw createSandboxError("Failed to invoke Sui transaction", response, error, {
      method: "POST",
      path: "/api/v1/tx/sui/invoke",
    });
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
  const tokenIn = requireNonEmpty(coalesce(request.token_in, request.tokenIn), "tokenIn", "swapSui");
  const tokenOut = requireNonEmpty(coalesce(request.token_out, request.tokenOut), "tokenOut", "swapSui");
  const amountWei = requireNonEmpty(coalesce(request.amount_wei, request.amount), "amount", "swapSui");
  const { data, error, response } = await client.client.POST("/api/v1/tx/swap/sui", {
    body: {
      ...withUid(rest, client.config.uid),
      token_in: tokenIn,
      token_out: tokenOut,
      amount_wei: amountWei,
    },
  });
  if (!response.ok || !data) {
    throw createSandboxError("Failed to swap Sui assets", response, error, {
      method: "POST",
      path: "/api/v1/tx/swap/sui",
    });
  }
  return data;
}
