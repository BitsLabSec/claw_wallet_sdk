import createClient from "openapi-fetch";
import type { paths } from "./generated/paths.js";

export type ClawWalletClientOptions = {
  /** Sandbox origin, e.g. `http://127.0.0.1:9000` (no trailing slash required). */
  baseUrl: string;
  /**
   * Same value as sandbox `AGENT_TOKEN` / client `CLAY_AGENT_TOKEN`.
   * Omit or pass empty string when sandbox runs with no token (local dev).
   */
  agentToken?: string;
  fetch?: typeof fetch;
};

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/**
 * Typed HTTP client for the Claw Wallet Sandbox OpenAPI.
 * All routes use the same `fetch` + JSON semantics as `openapi-fetch`.
 */
export function createClawWalletClient(options: ClawWalletClientOptions) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const client = createClient<paths>({
    baseUrl,
    fetch: options.fetch,
  });

  const token = options.agentToken?.trim();
  if (token) {
    client.use({
      onRequest({ request }) {
        const headers = new Headers(request.headers);
        headers.set("Authorization", `Bearer ${token}`);
        return new Request(request, { headers });
      },
    });
  }

  return client;
}

export type ClawWalletClient = ReturnType<typeof createClawWalletClient>;
