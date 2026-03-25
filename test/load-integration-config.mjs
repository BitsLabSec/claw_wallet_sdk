import { readFileSync, existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
export const DEFAULT_ENV_CLAY = join(REPO_ROOT, "claw_wallet_sdk", ".env.integration.local");

export function parseEnvClay(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

export function loadIntegrationConfig() {
  const fromEnv = {
    baseUrl: process.env.CLAY_SANDBOX_URL?.trim(),
    agentToken: process.env.CLAY_AGENT_TOKEN?.trim(),
  };

  let fileEnv = {};
  const raw = process.env.CLAW_INTEGRATION_ENV_CLAY?.trim();
  const envPath = raw
    ? isAbsolute(raw)
      ? raw
      : resolve(process.cwd(), raw)
    : DEFAULT_ENV_CLAY;
  if (existsSync(envPath)) {
    fileEnv = parseEnvClay(readFileSync(envPath, "utf8"));
  }

  const baseUrl = (
    fromEnv.baseUrl ||
    fileEnv.CLAY_SANDBOX_URL ||
    "http://127.0.0.1:9000"
  ).replace(/\/+$/, "");
  const agentToken =
    fromEnv.agentToken ||
    fileEnv.CLAY_AGENT_TOKEN ||
    fileEnv.AGENT_TOKEN ||
    "";

  return { baseUrl, agentToken, envPath, hadEnvFile: existsSync(envPath) };
}
