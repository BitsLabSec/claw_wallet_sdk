import type { ClawOperationClient, Schema } from "../util/operation-utils.js";
import { coalesce, errorText, withUid, type ClawInvokeResult } from "../util/operation-utils.js";

export type ClawSolanaInvokeRequest = Omit<
  Schema<"ManagedSolInvokeRequest">,
  "confirmed_by_user" | "unsigned_tx_base64" | "unsigned_tx_hex" | "tx_payload_base64" | "tx_payload_hex"
> & {
  confirmed_by_user?: boolean;
  confirmedByUser?: boolean;
  unsigned_tx_base64?: string;
  unsignedTxBase64?: string;
  unsigned_tx_hex?: string;
  unsignedTxHex?: string;
  tx_payload_base64?: string;
  txPayloadBase64?: string;
  tx_payload_hex?: string;
  txPayloadHex?: string;
};

export type ClawSolanaSwapRequest = Omit<
  Schema<"JupiterSwapRequest">,
  | "token_in"
  | "token_out"
  | "amount_in_wei"
  | "slippage_bps"
  | "exclude_routers"
  | "exclude_dexes"
  | "as_legacy_transaction"
  | "wrap_and_unwrap_sol"
  | "use_shared_accounts"
  | "dynamic_compute_unit_limit"
> & {
  token_in?: string;
  tokenIn?: string;
  token_out?: string;
  tokenOut?: string;
  amount_in_wei?: string;
  amountIn?: string;
  slippage_bps?: number;
  slippageBps?: number;
  exclude_routers?: string[];
  excludeRouters?: string[];
  exclude_dexes?: string[];
  excludeDexes?: string[];
  as_legacy_transaction?: boolean;
  asLegacyTransaction?: boolean;
  wrap_and_unwrap_sol?: boolean;
  wrapAndUnwrapSol?: boolean;
  use_shared_accounts?: boolean;
  useSharedAccounts?: boolean;
  dynamic_compute_unit_limit?: boolean;
  dynamicComputeUnitLimit?: boolean;
};

export type ClawSolanaSwapResponse = Schema<"JupiterSwapResponse">;

export async function invokeSolana(
  client: ClawOperationClient,
  request: ClawSolanaInvokeRequest,
): Promise<ClawInvokeResult> {
  const {
    unsignedTxBase64: _unsignedTxBase64,
    unsignedTxHex: _unsignedTxHex,
    txPayloadBase64: _txPayloadBase64,
    txPayloadHex: _txPayloadHex,
    confirmedByUser: _confirmedByUser,
    ...rest
  } = request;
  const { data, error, response } = await client.client.POST("/api/v1/tx/sol/invoke", {
    body: {
      ...withUid(rest, client.config.uid),
      unsigned_tx_base64: coalesce(request.unsigned_tx_base64, request.unsignedTxBase64),
      unsigned_tx_hex: coalesce(request.unsigned_tx_hex, request.unsignedTxHex),
      tx_payload_base64: coalesce(request.tx_payload_base64, request.txPayloadBase64),
      tx_payload_hex: coalesce(request.tx_payload_hex, request.txPayloadHex),
      confirmed_by_user: coalesce(request.confirmed_by_user, request.confirmedByUser),
    },
  });
  if (!response.ok || !data) {
    throw new Error(`Failed to invoke Solana transaction (${response.status}): ${errorText(error, response)}`);
  }
  return data;
}

export async function swapSolana(
  client: ClawOperationClient,
  request: ClawSolanaSwapRequest,
): Promise<ClawSolanaSwapResponse> {
  const {
    tokenIn: _tokenIn,
    tokenOut: _tokenOut,
    amountIn: _amountIn,
    slippageBps: _slippageBps,
    excludeRouters: _excludeRouters,
    excludeDexes: _excludeDexes,
    asLegacyTransaction: _asLegacyTransaction,
    wrapAndUnwrapSol: _wrapAndUnwrapSol,
    useSharedAccounts: _useSharedAccounts,
    dynamicComputeUnitLimit: _dynamicComputeUnitLimit,
    ...rest
  } = request;
  const { data, error, response } = await client.client.POST("/api/v1/tx/swap/solana", {
    body: {
      ...withUid(rest, client.config.uid),
      token_in: coalesce(request.token_in, request.tokenIn),
      token_out: coalesce(request.token_out, request.tokenOut) ?? "",
      amount_in_wei: coalesce(request.amount_in_wei, request.amountIn) ?? "",
      slippage_bps: coalesce(request.slippage_bps, request.slippageBps),
      exclude_routers: coalesce(request.exclude_routers, request.excludeRouters),
      exclude_dexes: coalesce(request.exclude_dexes, request.excludeDexes),
      as_legacy_transaction: coalesce(request.as_legacy_transaction, request.asLegacyTransaction),
      wrap_and_unwrap_sol: coalesce(request.wrap_and_unwrap_sol, request.wrapAndUnwrapSol),
      use_shared_accounts: coalesce(request.use_shared_accounts, request.useSharedAccounts),
      dynamic_compute_unit_limit: coalesce(
        request.dynamic_compute_unit_limit,
        request.dynamicComputeUnitLimit,
      ),
    },
  });
  if (!response.ok || !data) {
    throw new Error(`Failed to swap Solana assets (${response.status}): ${errorText(error, response)}`);
  }
  return data;
}
