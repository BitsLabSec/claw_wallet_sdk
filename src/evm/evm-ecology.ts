import type { ClawOperationClient, Schema } from "../util/operation-utils.js";
import { coalesce, errorText, withUid, type ClawInvokeResult } from "../util/operation-utils.js";

export type ClawEvmInvokeRequest = Omit<Schema<"ManagedEVMInvokeRequest">, "confirmed_by_user"> & {
  confirmed_by_user?: boolean;
  confirmedByUser?: boolean;
};

export type ClawEvmSwapRequest = Omit<
  Schema<"EvmSwapTradeAPIRequest">,
  | "token_in"
  | "token_out"
  | "amount_in_wei"
  | "routing_preference"
  | "auto_slippage"
  | "slippage_tolerance"
  | "permit_amount"
> & {
  token_in?: string;
  tokenIn?: string;
  token_out?: string;
  tokenOut?: string;
  amount_in_wei?: string;
  amountIn?: string;
  routing_preference?: string;
  routingPreference?: string;
  auto_slippage?: string;
  autoSlippage?: string;
  slippage_tolerance?: number;
  slippageTolerance?: number;
  permit_amount?: string;
  permitAmount?: string;
};

export type ClawEvmSwapResponse = Schema<"EvmSwapTradeAPIResponse">;

export async function invokeEvm(
  client: ClawOperationClient,
  request: ClawEvmInvokeRequest,
): Promise<ClawInvokeResult> {
  const { confirmedByUser: _confirmedByUser, ...rest } = request;
  const { data, error, response } = await client.client.POST("/api/v1/tx/evm/invoke", {
    body: {
      ...withUid(rest, client.config.uid),
      confirmed_by_user: coalesce(request.confirmed_by_user, request.confirmedByUser),
    },
  });
  if (!response.ok || !data) {
    throw new Error(`Failed to invoke EVM transaction (${response.status}): ${errorText(error, response)}`);
  }
  return data;
}

export async function swapEvm(
  client: ClawOperationClient,
  request: ClawEvmSwapRequest,
): Promise<ClawEvmSwapResponse> {
  const {
    tokenIn: _tokenIn,
    tokenOut: _tokenOut,
    amountIn: _amountIn,
    routingPreference: _routingPreference,
    autoSlippage: _autoSlippage,
    slippageTolerance: _slippageTolerance,
    permitAmount: _permitAmount,
    ...rest
  } = request;
  const { data, error, response } = await client.client.POST("/api/v1/tx/swap/evm", {
    body: {
      ...withUid(rest, client.config.uid),
      token_in: coalesce(request.token_in, request.tokenIn),
      token_out: coalesce(request.token_out, request.tokenOut) ?? "",
      amount_in_wei: coalesce(request.amount_in_wei, request.amountIn) ?? "",
      routing_preference: coalesce(request.routing_preference, request.routingPreference),
      auto_slippage: coalesce(request.auto_slippage, request.autoSlippage),
      slippage_tolerance: coalesce(request.slippage_tolerance, request.slippageTolerance),
      permit_amount: coalesce(request.permit_amount, request.permitAmount),
    },
  });
  if (!response.ok || !data) {
    throw new Error(`Failed to swap EVM assets (${response.status}): ${errorText(error, response)}`);
  }
  return data;
}
