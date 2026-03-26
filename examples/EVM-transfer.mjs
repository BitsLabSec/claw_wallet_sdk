import { parseEther, parseUnits, Transaction, formatEther } from "ethers";
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

const provider = createClawSandboxJsonRpcProvider({baseUrl: sandboxUrl,agentToken: sandboxToken,chainKey});
const signer = new ClawEthersSigner({uid,sandboxUrl,sandboxToken,},provider);
//测试数据
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
console.log("to", to);
console.log("amount(BNB)", amount);
console.log("chainId", network.chainId.toString());
console.log("nonce", nonce);
console.log("gasPrice", gasPrice.toString());
// 进行签名校验
const signedRawTx = await signer.signTransaction(txRequest);
const parsed = Transaction.from(signedRawTx);
const recoveredFrom = parsed.from ?? "";
const verified =
  recoveredFrom.toLowerCase() === from.toLowerCase() &&
  parsed.to?.toLowerCase() === to.toLowerCase();
// 确保签名无问题
if (!verified) {
  throw new Error(
    `signature check failed: recoveredFrom=${recoveredFrom}, expectedFrom=${from}, parsedTo=${parsed.to}, expectedTo=${to}`,
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