import type { components } from "./generated/paths.js";
import { createClawWalletClient, type ClawWalletClientOptions } from "./client.js";
import { ClawSDKError, createHttpError, createSandboxError } from "./errors.js";
import { requireNonEmpty, requireUrl } from "./util/validation.js";

export type ClawSignRequest = components["schemas"]["SignRequest"];
export type ClawSignResult = components["schemas"]["SignResult"];
export type ClawWalletStatus = components["schemas"]["WalletStatusResponse"];
export type ClawWalletInitRequest = components["schemas"]["WalletInitRequest"];
export type ClawWalletInitResponse = components["schemas"]["WalletInitResponse"];
export type ClawWalletUnlockRequest = components["schemas"]["WalletUnlockRequest"];
export type ClawWalletBindRequest = components["schemas"]["WalletBindRequest"];
export type ClawPolicy = components["schemas"]["Policy"];
export type ClawBroadcastRequest = components["schemas"]["BroadcastRequest"];
export type ClawBroadcastResponse = components["schemas"]["BroadcastResponse"];
export type ClawTransferRequest = components["schemas"]["TransferRequest"];
export type ClawWalletHistoryEntry = components["schemas"]["WalletHistoryEntry"];
export type ClawWalletHistory = ClawWalletHistoryEntry[];
export type ClawStatusMessage = components["schemas"]["StatusMessage"];
export type ClawAssetSnapshot = Record<string, unknown>;
export type ClawTransferResult = Record<string, unknown>;
export type ClawWalletBindResult = Record<string, unknown>;
export type ClawPolicyAddressNote = {
  address: string;
  note?: string;
  chain?: string;
};
export type ClawPolicyUpdatePatch = components["schemas"]["LocalPolicyUpdateRequest"];

const EVM_ADDRESS_FALLBACK_CHAINS = new Set([
  "ethereum",
  "0g",
  "kite",
  "base",
  "bsc",
  "arbitrum",
  "optimism",
  "polygon",
  "avalanche",
  "linea",
  "zksync",
  "monad",
  "tempo",
]);

export type ClawSignerConfig = {
  uid: string;
  sandboxUrl: string;
  sandboxToken: string;
  chain?: string;
  fetch?: ClawWalletClientOptions["fetch"];
};

function normalizeSandboxUrl(url: string): string {
  return requireUrl(url, "sandboxUrl", "ClawSandboxClient");
}

export class ClawSandboxClient {
  readonly config: ClawSignerConfig;

  constructor(config: ClawSignerConfig) {
    this.config = {
      ...config,
      uid: requireNonEmpty(config.uid, "uid", "ClawSandboxClient"),
      sandboxUrl: normalizeSandboxUrl(config.sandboxUrl),
      sandboxToken: config.sandboxToken ?? "",
    };
  }

  get client() {
    return createClawWalletClient({
      baseUrl: this.config.sandboxUrl,
      agentToken: this.config.sandboxToken,
      fetch: this.config.fetch,
    });
  }

  async requestExternalJson<T>(url: string): Promise<T> {
    const response = await (this.config.fetch ?? fetch)(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw await createHttpError("Claw external request failed", response, { method: "GET", path: url });
    }
    return await response.json() as T;
  }

  async sign(request: Omit<ClawSignRequest, "uid">): Promise<ClawSignResult> {
    const { data, error, response } = await this.client.POST("/api/v1/tx/sign", {
      body: {
        ...request,
        uid: this.config.uid,
      },
    });

    if (!response.ok || !data) {
      throw createSandboxError("Failed to sign transaction", response, error, {
        method: "POST",
        path: "/api/v1/tx/sign",
      });
    }

    return data;
  }

  async getStatus(): Promise<ClawWalletStatus> {
    const { data, error, response } = await this.client.GET("/api/v1/wallet/status", {});
    if (!response.ok || !data) {
      throw createSandboxError("Failed to get status", response, error, {
        method: "GET",
        path: "/api/v1/wallet/status",
      });
    }
    return data;
  }

  async initWallet(request?: ClawWalletInitRequest): Promise<ClawWalletInitResponse> {
    const { data, error, response } = await this.client.POST("/api/v1/wallet/init", {
      body: request,
    });
    if (!response.ok || !data) {
      throw createSandboxError("Failed to init wallet", response, error, {
        method: "POST",
        path: "/api/v1/wallet/init",
      });
    }
    return data;
  }

  async refreshWallet(): Promise<ClawStatusMessage> {
    const { data, error, response } = await this.client.POST("/api/v1/wallet/refresh", {});
    if (!response.ok || !data) {
      throw createSandboxError("Failed to trigger wallet refresh", response, error, {
        method: "POST",
        path: "/api/v1/wallet/refresh",
      });
    }
    return data;
  }

  async refreshAndGetAssets(): Promise<ClawAssetSnapshot> {
    const { data, error, response } = await this.client.GET("/api/v1/wallet/refreshAndAssets", {});
    if (!response.ok || !data) {
      throw createSandboxError("Failed to refresh and get assets", response, error, {
        method: "GET",
        path: "/api/v1/wallet/refreshAndAssets",
      });
    }
    return data;
  }

  async refreshChain(chain: string): Promise<Record<string, unknown>> {
    const normalizedChain = requireNonEmpty(chain, "chain", "refreshChain");
    const { data, error, response } = await this.client.POST("/api/v1/wallet/refresh/chain", {
      body: {
        chain: normalizedChain,
      },
    });
    if (!response.ok || !data) {
      throw createSandboxError("Failed to refresh chain", response, error, {
        method: "POST",
        path: "/api/v1/wallet/refresh/chain",
      });
    }
    return data as Record<string, unknown>;
  }

  async unlockWallet(request: ClawWalletUnlockRequest): Promise<ClawWalletStatus> {
    const { data, error, response } = await this.client.POST("/api/v1/wallet/unlock", {
      body: request,
    });
    if (!response.ok || !data) {
      throw createSandboxError("Failed to unlock wallet", response, error, {
        method: "POST",
        path: "/api/v1/wallet/unlock",
      });
    }
    return data;
  }

  async reactivateWallet(): Promise<ClawWalletStatus> {
    const { data, error, response } = await this.client.POST("/api/v1/wallet/reactivate", {});
    if (!response.ok || !data) {
      throw createSandboxError("Failed to reactivate wallet", response, error, {
        method: "POST",
        path: "/api/v1/wallet/reactivate",
      });
    }
    return data;
  }

  async wipeWallet(): Promise<ClawStatusMessage> {
    const { data, error, response } = await this.client.POST("/wipe", {});
    if (!response.ok || !data) {
      throw createSandboxError("Failed to wipe wallet", response, error, {
        method: "POST",
        path: "/wipe",
      });
    }
    return data;
  }

  async getAssets(): Promise<ClawAssetSnapshot> {
    const { data, error, response } = await this.client.GET("/api/v1/wallet/assets", {});
    if (!response.ok || !data) {
      throw createSandboxError("Failed to get assets", response, error, {
        method: "GET",
        path: "/api/v1/wallet/assets",
      });
    }
    return data;
  }

  async getHistory(query?: { chain?: string; limit?: number }): Promise<ClawWalletHistory> {
    const { data, error, response } = await this.client.GET("/api/v1/wallet/history", {
      params: { query },
    });
    if (!response.ok) {
      throw createSandboxError("Failed to get history", response, error, {
        method: "GET",
        path: "/api/v1/wallet/history",
      });
    }
    return Array.isArray(data) ? data : [];
  }

  async getLocalPolicy(): Promise<ClawPolicy> {
    const { data, error, response } = await this.client.GET("/api/v1/policy/local", {});
    if (!response.ok || !data) {
      throw createSandboxError("Failed to get local policy", response, error, {
        method: "GET",
        path: "/api/v1/policy/local",
      });
    }
    return data;
  }

  async updateLocalPolicy(patch: ClawPolicyUpdatePatch): Promise<ClawPolicy> {
    const { data, error, response } = await this.client.POST("/api/v1/policy/update", {
      body: patch,
    });
    if (!response.ok || !data) {
      throw createSandboxError("Failed to update local policy", response, error, {
        method: "POST",
        path: "/api/v1/policy/update",
      });
    }
    if (data.status !== "policy_updated") {
      throw new ClawSDKError("Unexpected policy update response", {
        code: "CLAW_UNEXPECTED_RESPONSE",
        method: "POST",
        path: "/api/v1/policy/update",
        details: data,
      });
    }
    return data.policy;
  }

  async getRequiredAddress(chain: string): Promise<string> {
    const status = await this.getStatus();
    const normalized = requireNonEmpty(chain, "chain", "getRequiredAddress").trim().toLowerCase();
    const address =
      status.addresses?.[normalized] ??
      (EVM_ADDRESS_FALLBACK_CHAINS.has(normalized)
        ? status.addresses?.ethereum ?? status.address
        : undefined);
    if (!address) {
      throw new ClawSDKError(`Claw Sandbox status did not include a ${chain} address`, {
        code: "CLAW_ADDRESS_NOT_FOUND",
        field: "chain",
        details: status.addresses,
      });
    }
    return address;
  }

  async bindWallet(request: ClawWalletBindRequest): Promise<ClawWalletBindResult> {
    const { data, error, response } = await this.client.POST("/api/v1/wallet/bind", {
      body: request,
    });
    if (!response.ok || !data) {
      throw createSandboxError("Failed to bind wallet", response, error, {
        method: "POST",
        path: "/api/v1/wallet/bind",
      });
    }
    return data;
  }

  async broadcast(request: ClawBroadcastRequest): Promise<ClawBroadcastResponse> {
    const { data, error, response } = await this.client.POST("/api/v1/tx/broadcast", {
      body: request,
    });
    if (!response.ok || !data) {
      throw createSandboxError("Failed to broadcast transaction", response, error, {
        method: "POST",
        path: "/api/v1/tx/broadcast",
      });
    }
    return data;
  }

  async broadcastTransaction(request: ClawBroadcastRequest): Promise<ClawBroadcastResponse> {
    return this.broadcast(request);
  }

  async transfer(request: ClawTransferRequest): Promise<ClawTransferResult> {
    const body = {
      ...request,
      chain: requireNonEmpty(request.chain, "chain", "transfer"),
      to: requireNonEmpty(request.to, "to", "transfer"),
      amount_wei: requireNonEmpty(request.amount_wei, "amount_wei", "transfer"),
    };
    const { data, error, response } = await this.client.POST("/api/v1/tx/transfer", {
      body,
    });
    if (!response.ok || !data) {
      throw createSandboxError("Failed to submit transfer", response, error, {
        method: "POST",
        path: "/api/v1/tx/transfer",
      });
    }
    return data;
  }
}
