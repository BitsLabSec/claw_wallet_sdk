import type { components } from "./generated/paths.js";
import type * as Client from "./client.js";
import * as EvmOps from "./evm/evm-ecology.js";
import { createSandboxError } from "./errors.js";
import * as Sandbox from "./sandbox.js";
import * as SolanaOps from "./solana/solana-ecology.js";
import * as SuiOps from "./sui/sui-ecology.js";
import * as OperationUtils from "./util/operation-utils.js";
import { requireNonEmpty, requireUrl } from "./util/validation.js";

type Schema<Name extends keyof components["schemas"]> = components["schemas"][Name];

export type ClawWalletOptions = {
  uid: string;
  sandboxUrl: string;
  token?: string;
  sandboxToken?: string;
  chain?: string;
  fetch?: Client.ClawWalletClientOptions["fetch"];
};

export type ClawWalletConfig = Sandbox.ClawSignerConfig;

export type ClawWalletBindUIDRequest = Schema<"WalletBindUIDRequest">;
export type ClawWalletImportRequest = Schema<"WalletImportRequest">;
export type ClawWalletProvisionRequest = Schema<"WalletProvisionRequest">;
export type ClawWalletBackup = Record<string, unknown>;

export type ClawTransferRequestInput = Omit<
  Sandbox.ClawTransferRequest,
  "amount_wei" | "token_contract" | "sui_gas_budget" | "confirmed_by_user" | "approval_id" | "execution_token"
> & {
  amount_wei?: string;
  amount?: string;
  token_contract?: string;
  tokenContract?: string;
  sui_gas_budget?: string;
  suiGasBudget?: string;
  confirmed_by_user?: boolean;
  confirmedByUser?: boolean;
  approval_id?: string;
  approvalId?: string;
  execution_token?: string;
  executionToken?: string;
};

export type ClawLifiBridgeRequest = Omit<
  Schema<"LifiBridgeRequest">,
  "via_solana" | "from_chain_id" | "from_address" | "from_token" | "to_chain_id" | "to_address" | "to_token"
> & {
  via_solana?: boolean;
  viaSolana?: boolean;
  from_chain_id?: string;
  fromChainId?: string;
  from_address?: string;
  fromAddress?: string;
  from_token?: string;
  fromToken?: string;
  to_chain_id?: string;
  toChainId?: string;
  to_address?: string;
  toAddress?: string;
  to_token?: string;
  toToken?: string;
};
export type ClawLifiQuoteResponse = Schema<"LifiQuoteResponse">;
export type ClawLifiBridgeResponse = Schema<"LifiBridgeResponse">;
export type ClawLifiTokensResponse = Record<string, unknown>;

function coalesce<T>(first: T | undefined, second: T | undefined): T | undefined {
  return first !== undefined ? first : second;
}

function withUid<T extends { uid?: string }>(request: T | undefined, uid: string): T & { uid: string } {
  return {
    ...(request ?? {} as T),
    uid: request?.uid ?? uid,
  };
}

export class ClawWallet extends Sandbox.ClawSandboxClient {
  /** Wallet lifecycle and read APIs grouped for the common integration path. */
  readonly wallet = {
    status: () => this.getStatus(),
    init: (request?: Sandbox.ClawWalletInitRequest) => this.initWallet(request),
    unlock: (request: Sandbox.ClawWalletUnlockRequest) => this.unlockWallet(request),
    reactivate: () => this.reactivateWallet(),
    backup: () => this.backupWallet(),
    import: (request: ClawWalletImportRequest) => this.importWallet(request),
    provision: (request: ClawWalletProvisionRequest) => this.provisionWallet(request),
    bindUid: (request?: Partial<ClawWalletBindUIDRequest>) => this.bindUid(request),
    bind: (request: Sandbox.ClawWalletBindRequest) => this.bindWallet(request),
    assets: () => this.getAssets(),
    refresh: () => this.refreshWallet(),
    refreshAndAssets: () => this.refreshAndGetAssets(),
    refreshChain: (chain: string) => this.refreshChain(chain),
    history: (query?: { chain?: string; limit?: number }) => this.getHistory(query),
    policy: () => this.getLocalPolicy(),
    updatePolicy: (patch: Sandbox.ClawPolicyUpdatePatch) => this.updateLocalPolicy(patch),
  };

  /** Signing, broadcast, transfer, and managed chain invoke helpers. */
  readonly tx = {
    sign: (request: Omit<Sandbox.ClawSignRequest, "uid">) => this.sign(request),
    broadcast: (request: Sandbox.ClawBroadcastRequest) => this.broadcast(request),
    transfer: (request: ClawTransferRequestInput) => this.transfer(request),
    evm: {
      invoke: (request: EvmOps.ClawEvmInvokeRequest) => this.invokeEvm(request),
    },
    solana: {
      invoke: (request: SolanaOps.ClawSolanaInvokeRequest) => this.invokeSolana(request),
    },
    sui: {
      invoke: (request: SuiOps.ClawSuiInvokeRequest) => this.invokeSui(request),
      haedal: (request: SuiOps.ClawSuiHaedalRequest) => this.invokeSuiHaedal(request),
    },
  };

  /** Same-chain swaps across EVM, Solana, and Sui. */
  readonly swap = {
    evm: (request: EvmOps.ClawEvmSwapRequest) => this.swapEvm(request),
    solana: (request: SolanaOps.ClawSolanaSwapRequest) => this.swapSolana(request),
    sui: (request: SuiOps.ClawSuiSwapRequest) => this.swapSui(request),
  };

  /** Cross-chain bridge helpers currently backed by LI.FI routes. */
  readonly bridge = {
    lifi: {
      tokens: (chains: string | readonly string[]) => this.getLifiTokens(chains),
      quote: (request: ClawLifiBridgeRequest) => this.quoteLifiBridge(request),
      execute: (request: ClawLifiBridgeRequest) => this.executeLifiBridge(request),
      getStatus: (finalStatusUrl: string) => this.getLifiBridgeStatus(finalStatusUrl),
    },
  };

  readonly policy = {
    get: () => this.getLocalPolicy(),
    update: (patch: Sandbox.ClawPolicyUpdatePatch) => this.updateLocalPolicy(patch),
  };

  readonly assets = {
    get: () => this.getAssets(),
    refresh: () => this.refreshWallet(),
    refreshAndGet: () => this.refreshAndGetAssets(),
    refreshChain: (chain: string) => this.refreshChain(chain),
    history: (query?: { chain?: string; limit?: number }) => this.getHistory(query),
  };

  constructor(options: ClawWalletOptions) {
    super({
      uid: requireNonEmpty(options.uid, "uid", "ClawWallet"),
      sandboxUrl: requireUrl(options.sandboxUrl, "sandboxUrl", "ClawWallet"),
      sandboxToken: options.token ?? options.sandboxToken ?? "",
      chain: options.chain,
      fetch: options.fetch,
    });
  }

  async status(): Promise<Sandbox.ClawWalletStatus> {
    return this.wallet.status();
  }

  async assetsSnapshot(): Promise<Sandbox.ClawAssetSnapshot> {
    return this.wallet.assets();
  }

  async history(query?: { chain?: string; limit?: number }): Promise<Sandbox.ClawWalletHistory> {
    return this.wallet.history(query);
  }

  async sign(request: Omit<Sandbox.ClawSignRequest, "uid">): Promise<Sandbox.ClawSignResult> {
    return this.tx.sign(request);
  }

  async broadcast(request: Sandbox.ClawBroadcastRequest): Promise<Sandbox.ClawBroadcastResponse> {
    return super.broadcast(withUid(request, this.config.uid));
  }

  async transfer(request: ClawTransferRequestInput): Promise<Sandbox.ClawTransferResult> {
    const {
      amount: _amount,
      tokenContract: _tokenContract,
      suiGasBudget: _suiGasBudget,
      confirmedByUser: _confirmedByUser,
      approvalId: _approvalId,
      executionToken: _executionToken,
      ...rest
    } = request;
    const amountWei = requireNonEmpty(coalesce(request.amount_wei, request.amount), "amount", "transfer");
    return super.transfer({
      ...withUid(rest, this.config.uid),
      amount_wei: amountWei,
      token_contract: coalesce(request.token_contract, request.tokenContract),
      sui_gas_budget: coalesce(request.sui_gas_budget, request.suiGasBudget),
      confirmed_by_user: coalesce(request.confirmed_by_user, request.confirmedByUser),
      approval_id: coalesce(request.approval_id, request.approvalId),
      execution_token: coalesce(request.execution_token, request.executionToken),
    });
  }

  async backupWallet(): Promise<ClawWalletBackup> {
    const { data, error, response } = await this.client.GET("/api/v1/wallet/backup", {});
    if (!response.ok || !data) {
      throw createSandboxError("Failed to backup wallet", response, error, {
        method: "GET",
        path: "/api/v1/wallet/backup",
      });
    }
    return data;
  }

  async importWallet(request: ClawWalletImportRequest): Promise<Sandbox.ClawWalletStatus> {
    const { data, error, response } = await this.client.POST("/api/v1/wallet/import", {
      body: request,
    });
    if (!response.ok || !data) {
      throw createSandboxError("Failed to import wallet", response, error, {
        method: "POST",
        path: "/api/v1/wallet/import",
      });
    }
    return data;
  }

  async provisionWallet(request: ClawWalletProvisionRequest): Promise<Sandbox.ClawWalletStatus> {
    const { data, error, response } = await this.client.POST("/api/v1/wallet/provision", {
      body: request,
    });
    if (!response.ok || !data) {
      throw createSandboxError("Failed to provision wallet", response, error, {
        method: "POST",
        path: "/api/v1/wallet/provision",
      });
    }
    return data;
  }

  async bindUid(request?: Partial<ClawWalletBindUIDRequest>): Promise<{ status?: string; uid?: string }> {
    const { data, error, response } = await this.client.POST("/api/v1/wallet/bind_uid", {
      body: withUid(request, this.config.uid),
    });
    if (!response.ok || !data) {
      throw createSandboxError("Failed to bind uid", response, error, {
        method: "POST",
        path: "/api/v1/wallet/bind_uid",
      });
    }
    return data;
  }

  async invokeEvm(request: EvmOps.ClawEvmInvokeRequest): Promise<OperationUtils.ClawInvokeResult> {
    return EvmOps.invokeEvm(this, request);
  }

  async invokeSolana(request: SolanaOps.ClawSolanaInvokeRequest): Promise<OperationUtils.ClawInvokeResult> {
    return SolanaOps.invokeSolana(this, request);
  }

  async invokeSui(request: SuiOps.ClawSuiInvokeRequest): Promise<OperationUtils.ClawInvokeResult> {
    return SuiOps.invokeSui(this, request);
  }

  async invokeSuiHaedal(request: SuiOps.ClawSuiHaedalRequest): Promise<SuiOps.ClawSuiTxResponse> {
    return SuiOps.invokeSuiHaedal(this, request);
  }

  async swapEvm(request: EvmOps.ClawEvmSwapRequest): Promise<EvmOps.ClawEvmSwapResponse> {
    return EvmOps.swapEvm(this, request);
  }

  async swapSolana(request: SolanaOps.ClawSolanaSwapRequest): Promise<SolanaOps.ClawSolanaSwapResponse> {
    return SolanaOps.swapSolana(this, request);
  }

  async swapSui(request: SuiOps.ClawSuiSwapRequest): Promise<SuiOps.ClawSuiSwapResponse> {
    return SuiOps.swapSui(this, request);
  }

  async getLifiTokens(chains: string | readonly string[]): Promise<ClawLifiTokensResponse> {
    const chainParam = typeof chains === "string" ? chains : chains.join(",");
    requireNonEmpty(chainParam, "chains", "getLifiTokens");
    const { data, error, response } = await this.client.GET("/api/v1/tx/bridge/lifi/tokens", {
      params: { query: { chains: chainParam } },
    });
    if (!response.ok || !data) {
      throw createSandboxError("Failed to get LI.FI tokens", response, error, {
        method: "GET",
        path: "/api/v1/tx/bridge/lifi/tokens",
      });
    }
    return data;
  }

  async quoteLifiBridge(request: ClawLifiBridgeRequest): Promise<ClawLifiQuoteResponse> {
    const { data, error, response } = await this.client.POST("/api/v1/tx/bridge/lifi/quote", {
      body: this.toLifiBridgeBody(request),
    });
    if (!response.ok || !data) {
      throw createSandboxError("Failed to quote LI.FI bridge", response, error, {
        method: "POST",
        path: "/api/v1/tx/bridge/lifi/quote",
      });
    }
    return data;
  }

  async executeLifiBridge(request: ClawLifiBridgeRequest): Promise<ClawLifiBridgeResponse> {
    const { data, error, response } = await this.client.POST("/api/v1/tx/bridge/lifi/execute", {
      body: this.toLifiBridgeBody(request),
    });
    if (!response.ok || !data) {
      throw createSandboxError("Failed to execute LI.FI bridge", response, error, {
        method: "POST",
        path: "/api/v1/tx/bridge/lifi/execute",
      });
    }
    return data;
  }

  async getLifiBridgeStatus(finalStatusUrl: string): Promise<unknown> {
    return this.requestExternalJson<unknown>(requireUrl(finalStatusUrl, "finalStatusUrl", "getLifiBridgeStatus"));
  }

  async getPolicy(): Promise<Sandbox.ClawPolicy> {
    return this.policy.get();
  }

  private toLifiBridgeBody(request: ClawLifiBridgeRequest): Schema<"LifiBridgeRequest"> {
    const {
      viaSolana: _viaSolana,
      fromChainId: _fromChainId,
      fromAddress: _fromAddress,
      fromToken: _fromToken,
      toChainId: _toChainId,
      toAddress: _toAddress,
      toToken: _toToken,
      ...rest
    } = request;
    const body = {
      ...rest,
      via_solana: coalesce(request.via_solana, request.viaSolana),
      from_chain_id: requireNonEmpty(coalesce(request.from_chain_id, request.fromChainId), "fromChainId", "bridge.lifi"),
      from_address: requireNonEmpty(coalesce(request.from_address, request.fromAddress), "fromAddress", "bridge.lifi"),
      from_token: requireNonEmpty(coalesce(request.from_token, request.fromToken), "fromToken", "bridge.lifi"),
      amount: requireNonEmpty(request.amount, "amount", "bridge.lifi"),
      to_chain_id: requireNonEmpty(coalesce(request.to_chain_id, request.toChainId), "toChainId", "bridge.lifi"),
      to_address: requireNonEmpty(coalesce(request.to_address, request.toAddress), "toAddress", "bridge.lifi"),
      to_token: requireNonEmpty(coalesce(request.to_token, request.toToken), "toToken", "bridge.lifi"),
    };
    return body;
  }
}
