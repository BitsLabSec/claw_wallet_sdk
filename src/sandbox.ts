import type { components } from "./generated/paths.js";
import { createClawWalletClient, type ClawWalletClientOptions } from "./client.js";

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

export type ClawSignerConfig = {
  uid: string;
  sandboxUrl: string;
  sandboxToken: string;
  fetch?: ClawWalletClientOptions["fetch"];
};

function errorText(error: unknown, response: Response): string {
  if (typeof error === "string" && error) return error;
  return response.statusText || "Unknown error";
}

export class ClawSandboxClient {
  readonly config: ClawSignerConfig;

  constructor(config: ClawSignerConfig) {
    this.config = {
      ...config,
      sandboxUrl: config.sandboxUrl.replace(/\/+$/, ""),
    };
  }

  private get client() {
    return createClawWalletClient({
      baseUrl: this.config.sandboxUrl,
      agentToken: this.config.sandboxToken,
      fetch: this.config.fetch,
    });
  }

  async sign(request: Omit<ClawSignRequest, "uid">): Promise<ClawSignResult> {
    const { data, error, response } = await this.client.POST("/api/v1/tx/sign", {
      body: {
        ...request,
        uid: this.config.uid,
      },
    });

    if (!response.ok || !data) {
      throw new Error(`Claw Sandbox Error (${response.status}): ${errorText(error, response)}`);
    }

    return data;
  }

  async getStatus(): Promise<ClawWalletStatus> {
    const { data, error, response } = await this.client.GET("/api/v1/wallet/status", {});
    if (!response.ok || !data) {
      throw new Error(`Failed to get status (${response.status}): ${errorText(error, response)}`);
    }
    return data;
  }

  async initWallet(request?: ClawWalletInitRequest): Promise<ClawWalletInitResponse> {
    const { data, error, response } = await this.client.POST("/api/v1/wallet/init", {
      body: request,
    });
    if (!response.ok || !data) {
      throw new Error(`Failed to init wallet (${response.status}): ${errorText(error, response)}`);
    }
    return data;
  }

  async refreshWallet(): Promise<ClawStatusMessage> {
    const { data, error, response } = await this.client.POST("/api/v1/wallet/refresh", {});
    if (!response.ok || !data) {
      throw new Error(`Failed to trigger wallet refresh (${response.status}): ${errorText(error, response)}`);
    }
    return data;
  }

  async unlockWallet(request: ClawWalletUnlockRequest): Promise<ClawWalletStatus> {
    const { data, error, response } = await this.client.POST("/api/v1/wallet/unlock", {
      body: request,
    });
    if (!response.ok || !data) {
      throw new Error(`Failed to unlock wallet (${response.status}): ${errorText(error, response)}`);
    }
    return data;
  }

  async reactivateWallet(): Promise<ClawWalletStatus> {
    const { data, error, response } = await this.client.POST("/api/v1/wallet/reactivate", {});
    if (!response.ok || !data) {
      throw new Error(`Failed to reactivate wallet (${response.status}): ${errorText(error, response)}`);
    }
    return data;
  }

  async getAssets(): Promise<ClawAssetSnapshot> {
    const { data, error, response } = await this.client.GET("/api/v1/wallet/assets", {});
    if (!response.ok || !data) {
      throw new Error(`Failed to get assets (${response.status}): ${errorText(error, response)}`);
    }
    return data;
  }

  async getHistory(query?: { chain?: string; limit?: number }): Promise<ClawWalletHistory> {
    const { data, error, response } = await this.client.GET("/api/v1/wallet/history", {
      params: { query },
    });
    if (!response.ok) {
      throw new Error(`Failed to get history (${response.status}): ${errorText(error, response)}`);
    }
    return Array.isArray(data) ? data : [];
  }

  async getLocalPolicy(): Promise<ClawPolicy> {
    const { data, error, response } = await this.client.GET("/api/v1/policy/local", {});
    if (!response.ok || !data) {
      throw new Error(`Failed to get local policy (${response.status}): ${errorText(error, response)}`);
    }
    return data;
  }

  async getRequiredAddress(chain: string): Promise<string> {
    const status = await this.getStatus();
    const address = status.addresses?.[chain] ?? (chain === "ethereum" ? status.address : undefined);
    if (!address) {
      throw new Error(`Claw Sandbox status did not include a ${chain} address`);
    }
    return address;
  }

  async bindWallet(request: ClawWalletBindRequest): Promise<ClawWalletBindResult> {
    const { data, error, response } = await this.client.POST("/api/v1/wallet/bind", {
      body: request,
    });
    if (!response.ok || !data) {
      throw new Error(`Failed to bind wallet (${response.status}): ${errorText(error, response)}`);
    }
    return data;
  }

  async broadcast(request: ClawBroadcastRequest): Promise<ClawBroadcastResponse> {
    const { data, error, response } = await this.client.POST("/api/v1/tx/broadcast", {
      body: request,
    });
    if (!response.ok || !data) {
      throw new Error(`Failed to broadcast transaction (${response.status}): ${errorText(error, response)}`);
    }
    return data;
  }

  async transfer(request: ClawTransferRequest): Promise<ClawTransferResult> {
    const { data, error, response } = await this.client.POST("/api/v1/tx/transfer", {
      body: request,
    });
    if (!response.ok || !data) {
      throw new Error(`Failed to submit transfer (${response.status}): ${errorText(error, response)}`);
    }
    return data;
  }
}
