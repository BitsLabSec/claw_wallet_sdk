import type { ClawOperationClient, Schema } from "../util/operation-utils.js";
import { coalesce, createSandboxError, withUid, type ClawInvokeResult } from "../util/operation-utils.js";
import { requireNonEmpty } from "../util/validation.js";

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
  const to = requireNonEmpty(request.to, "to", "invokeEvm");
  const { data, error, response } = await client.client.POST("/api/v1/tx/evm/invoke", {
    body: {
      ...withUid(rest, client.config.uid),
      to,
      confirmed_by_user: coalesce(request.confirmed_by_user, request.confirmedByUser),
    },
  });
  if (!response.ok || !data) {
    throw createSandboxError("Failed to invoke EVM transaction", response, error, {
      method: "POST",
      path: "/api/v1/tx/evm/invoke",
    });
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
  const chain = requireNonEmpty(request.chain, "chain", "swapEvm") as ClawEvmSwapRequest["chain"];
  const tokenOut = requireNonEmpty(coalesce(request.token_out, request.tokenOut), "tokenOut", "swapEvm");
  const amountInWei = requireNonEmpty(
    coalesce(request.amount_in_wei, request.amountIn),
    "amountIn",
    "swapEvm",
  );
  const { data, error, response } = await client.client.POST("/api/v1/tx/swap/evm", {
    body: {
      ...withUid(rest, client.config.uid),
      chain,
      token_in: coalesce(request.token_in, request.tokenIn),
      token_out: tokenOut,
      amount_in_wei: amountInWei,
      routing_preference: coalesce(request.routing_preference, request.routingPreference),
      auto_slippage: coalesce(request.auto_slippage, request.autoSlippage),
      slippage_tolerance: coalesce(request.slippage_tolerance, request.slippageTolerance),
      permit_amount: coalesce(request.permit_amount, request.permitAmount),
    },
  });
  if (!response.ok || !data) {
    throw createSandboxError("Failed to swap EVM assets", response, error, {
      method: "POST",
      path: "/api/v1/tx/swap/evm",
    });
  }
  return data;
}
