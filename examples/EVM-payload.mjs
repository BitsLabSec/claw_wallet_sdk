import { parseEther, parseUnits, Transaction, formatEther } from "ethers";
import { ClawEthersSigner, createClawSandboxJsonRpcProvider } from "../dist/ethers.js";

const sandboxUrl = process.env.CLAY_SANDBOX_URL ?? "http://127.0.0.1:9000";
const sandboxToken = process.env.CLAY_AGENT_TOKEN?.trim() ?? "";
const uid = process.env.CLAY_UID?.trim() ?? "";
const payloadTo = "0xaddress";
const payloadValue = 10000000000n; // 10 Gwei in wei
const payloadData = "0x000aaa";
const chainKey = process.env.BSC_CHAIN_KEY ?? "bsc";

console.log("to", payloadTo);
console.log("value", payloadValue.toString());
console.log("chainKey", chainKey);
console.log("data", payloadData);

const provider = createClawSandboxJsonRpcProvider({
  baseUrl: sandboxUrl,
  agentToken: sandboxToken,
  chainKey,
});

const signer = new ClawEthersSigner(
  {
    uid,
    sandboxUrl,
    sandboxToken,
  },
  provider,
);
//测试数据
const from = await signer.getAddress();
const network = await provider.getNetwork();
const nonce = await provider.getTransactionCount(from, "pending");
const feeData = await provider.getFeeData();
const gasPrice = feeData.gasPrice ?? parseUnits("3", "gwei");

const txRequest = {
  to: payloadTo,
  value: payloadValue,
  data: payloadData,
  nonce,
  gasLimit: 500000n, // Increased gas limit for contract call
  gasPrice,
  chainId: network.chainId,
};

console.log("from", from);
console.log("to", payloadTo);
console.log("value(wei)", payloadValue.toString());
console.log("chainId", network.chainId.toString());
console.log("nonce", nonce);
console.log("gasPrice", gasPrice.toString());
// 进行签名校验
const signedRawTx = await signer.signTransaction(txRequest);
const parsed = Transaction.from(signedRawTx);
const recoveredFrom = parsed.from ?? "";
const verified =
  recoveredFrom.toLowerCase() === from.toLowerCase() &&
  parsed.to?.toLowerCase() === payloadTo.toLowerCase();
// 确保签名无问题
if (!verified) {
  throw new Error(
    `signature check failed: recoveredFrom=${recoveredFrom}, expectedFrom=${from}, parsedTo=${parsed.to}, expectedTo=${payloadTo}`,
  );
}

console.log("signature check passed");
console.log("signed tx bytes", signedRawTx.length / 2 - 1);
// 发起交易
const pending = await provider.broadcastTransaction(signedRawTx);
console.log("broadcasted tx hash", pending.hash);

const receipt = await pending.wait();
if (!receipt) {
  throw new Error("broadcast returned no receipt");
}

console.log("mined tx hash", receipt.hash);
console.log("blockNumber", receipt.blockNumber);
console.log("gasUsed", receipt.gasUsed.toString());
console.log("effectiveGasPrice", receipt.gasPrice?.toString() ?? "");
console.log("sent amount(BNB)", formatEther(txRequest.value));