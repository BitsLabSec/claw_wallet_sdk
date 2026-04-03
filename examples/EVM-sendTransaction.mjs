import { parseEther, parseUnits, formatEther } from "ethers";
import { ClawEthersSigner, createClawSandboxJsonRpcProvider } from "../dist/ethers.js";

const sandboxUrl = process.env.CLAY_SANDBOX_URL ?? "http://127.0.0.1:9000";
const sandboxToken = process.env.CLAY_AGENT_TOKEN?.trim() ?? "";
const uid = process.env.CLAY_UID?.trim() ?? "";
const to = process.env.BSC_TO?.trim() ?? "";
const amount = process.env.BSC_AMOUNT ?? "0.0001";
const chainKey = process.env.BSC_CHAIN_KEY ?? "bsc";

if (!uid) throw new Error("missing CLAY_UID");
if (!to) throw new Error("missing BSC_TO");

console.log("to", to);
console.log("amount", amount);
console.log("chainKey", chainKey);

const provider = createClawSandboxJsonRpcProvider({
  baseUrl: sandboxUrl,
  agentToken: sandboxToken,
  chainKey,
});
const signer = new ClawEthersSigner({ uid, sandboxUrl, sandboxToken }, provider);

const from = await signer.getAddress();
const network = await provider.getNetwork();
const nonce = await provider.getTransactionCount(from, "pending");
const feeData = await provider.getFeeData();
const gasPrice = feeData.gasPrice ?? parseUnits("3", "gwei");

const txRequest = {
  to,
  value: parseEther(amount),
  nonce,
  gasLimit: 21000n,
  gasPrice,
  chainId: network.chainId,
};

console.log("from", from);
console.log("chainId", network.chainId.toString());
console.log("nonce", nonce);
console.log("gasPrice", gasPrice.toString());

const pending = await signer.sendTransaction(txRequest);
console.log("broadcasted tx hash", pending.hash);

const receipt = await pending.wait();
if (!receipt) {
  throw new Error("sendTransaction returned no receipt");
}

console.log("mined tx hash", receipt.hash);
console.log("blockNumber", receipt.blockNumber);
console.log("gasUsed", receipt.gasUsed.toString());
console.log("effectiveGasPrice", receipt.gasPrice?.toString() ?? "");
console.log("sent amount", formatEther(txRequest.value));