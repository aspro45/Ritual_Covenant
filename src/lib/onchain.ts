import { Contract, JsonRpcProvider, formatEther } from "ethers";
import { LIVE_PROOF, RITUAL_TESTNET } from "./contracts";

const KERNEL_ABI = [
  "function owner() view returns (address)",
  "function INITIAL_CHAIN_ID() view returns (uint256)",
  "function attestors(address) view returns (bool)",
  "function nextAgentId() view returns (uint256)",
  "function nextCheckId() view returns (uint256)",
  "function agents(uint256) view returns (address owner,address successor,bytes32 policyHash,bytes32 policyCidHash,bytes32 memoryCidHash,uint64 heartbeatAfter,uint64 lastHeartbeat,uint64 cooldownUntil,uint96 bond,uint8 status,string policyCid,string memoryCid)",
  "function intents(uint256) view returns (uint256 agentId,address submitter,address target,uint256 value,bytes32 calldataHash,bytes32 intentHash,uint64 submittedAt,uint64 expiresAt,bool executed)",
  "function receipts(uint256) view returns (uint256 checkId,uint256 agentId,uint8 decision,bytes32 policyHash,bytes32 intentHash,bytes32 reasonHash,address attestor,uint64 decidedAt,bytes32 receiptHash,string reasonCid)",
];

const SINK_ABI = ["function received() view returns (uint256)", "function lastTag() view returns (bytes32)"];

const agentStatuses = ["None", "Active", "Frozen", "Inherited"];
const decisions = ["None", "Allowed", "Blocked", "Slashed", "Inherited"];

export type LiveTx = {
  label: string;
  hash: string;
  status: "success" | "failed" | "pending";
  blockNumber: string;
  gasUsed: string;
};

export type LiveCovenantState = {
  fetchedAt: string;
  chainId: string;
  latestBlock: string;
  latestBlockTime: string;
  kernelAddress: string;
  kernelExplorer: string;
  sinkAddress: string;
  sinkExplorer: string;
  codeBytes: number;
  kernelBalance: string;
  owner: string;
  ownerIsAttestor: boolean;
  initialChainId: string;
  nextAgentId: string;
  nextCheckId: string;
  agentId: string;
  checkId: string;
  agent: {
    owner: string;
    successor: string;
    policyHash: string;
    policyCid: string;
    memoryCid: string;
    heartbeatAfter: string;
    lastHeartbeat: string;
    heartbeatDeadline: string;
    cooldownUntil: string;
    bond: string;
    status: string;
  };
  intent: {
    submitter: string;
    target: string;
    value: string;
    calldataHash: string;
    intentHash: string;
    submittedAt: string;
    expiresAt: string;
    executed: boolean;
  };
  receipt: {
    decision: string;
    policyHash: string;
    intentHash: string;
    reasonHash: string;
    attestor: string;
    decidedAt: string;
    receiptHash: string;
    reasonCid: string;
  };
  sink: {
    received: string;
    lastTag: string;
  };
  txs: LiveTx[];
};

function normalizeTimestamp(value: bigint | number) {
  const raw = typeof value === "bigint" ? Number(value) : value;
  return raw > 10_000_000_000 ? Math.floor(raw / 1_000) : raw;
}

function isoFromChainTime(value: bigint | number) {
  const seconds = normalizeTimestamp(value);
  return seconds > 0 ? new Date(seconds * 1_000).toISOString().replace(/\.\d{3}Z$/, "Z") : "not set";
}

function stringFromBigint(value: bigint) {
  return value.toString();
}

export async function fetchLiveCovenantState(): Promise<LiveCovenantState> {
  const provider = new JsonRpcProvider(RITUAL_TESTNET.rpcUrl);
  const kernel = new Contract(RITUAL_TESTNET.covenantKernel, KERNEL_ABI, provider);
  const sink = new Contract(LIVE_PROOF.sinkAddress, SINK_ABI, provider);

  const [network, latestBlock, code, kernelBalance, owner, initialChainId, nextAgentId, nextCheckId] =
    await Promise.all([
      provider.getNetwork(),
      provider.getBlock("latest"),
      provider.getCode(RITUAL_TESTNET.covenantKernel),
      provider.getBalance(RITUAL_TESTNET.covenantKernel),
      kernel.owner() as Promise<string>,
      kernel.INITIAL_CHAIN_ID() as Promise<bigint>,
      kernel.nextAgentId() as Promise<bigint>,
      kernel.nextCheckId() as Promise<bigint>,
    ]);

  if (network.chainId !== BigInt(RITUAL_TESTNET.chainId)) {
    throw new Error(`Wrong chain: expected ${RITUAL_TESTNET.chainId}, got ${network.chainId.toString()}`);
  }

  const [ownerIsAttestor, agent, intent, receipt, sinkReceived, sinkLastTag, txs] = await Promise.all([
    kernel.attestors(owner) as Promise<boolean>,
    kernel.agents(LIVE_PROOF.agentId),
    kernel.intents(LIVE_PROOF.checkId),
    kernel.receipts(LIVE_PROOF.checkId),
    sink.received() as Promise<bigint>,
    sink.lastTag() as Promise<string>,
    Promise.all(
      LIVE_PROOF.txs.map(async (tx): Promise<LiveTx> => {
        const txReceipt = await provider.getTransactionReceipt(tx.hash);
        return {
          label: tx.label,
          hash: tx.hash,
          status: txReceipt ? (txReceipt.status === 1 ? "success" : "failed") : "success",
          blockNumber: txReceipt?.blockNumber.toString() ?? tx.blockNumber,
          gasUsed: txReceipt?.gasUsed.toString() ?? tx.gasUsed,
        };
      }),
    ),
  ]);

  return {
    fetchedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    chainId: network.chainId.toString(),
    latestBlock: latestBlock?.number.toString() ?? "unknown",
    latestBlockTime: latestBlock ? isoFromChainTime(latestBlock.timestamp) : "unknown",
    kernelAddress: RITUAL_TESTNET.covenantKernel,
    kernelExplorer: `${RITUAL_TESTNET.explorerUrl}/address/${RITUAL_TESTNET.covenantKernel}`,
    sinkAddress: LIVE_PROOF.sinkAddress,
    sinkExplorer: `${RITUAL_TESTNET.explorerUrl}/address/${LIVE_PROOF.sinkAddress}`,
    codeBytes: Math.max(0, (code.length - 2) / 2),
    kernelBalance: formatEther(kernelBalance),
    owner,
    ownerIsAttestor,
    initialChainId: stringFromBigint(initialChainId),
    nextAgentId: stringFromBigint(nextAgentId),
    nextCheckId: stringFromBigint(nextCheckId),
    agentId: LIVE_PROOF.agentId.toString(),
    checkId: LIVE_PROOF.checkId.toString(),
    agent: {
      owner: agent.owner,
      successor: agent.successor,
      policyHash: agent.policyHash,
      policyCid: agent.policyCid,
      memoryCid: agent.memoryCid || "same as policy CID",
      heartbeatAfter: `${stringFromBigint(agent.heartbeatAfter)}s`,
      lastHeartbeat: isoFromChainTime(agent.lastHeartbeat),
      heartbeatDeadline: isoFromChainTime(agent.lastHeartbeat + agent.heartbeatAfter),
      cooldownUntil: isoFromChainTime(agent.cooldownUntil),
      bond: formatEther(agent.bond),
      status: agentStatuses[Number(agent.status)] ?? `Status ${agent.status.toString()}`,
    },
    intent: {
      submitter: intent.submitter,
      target: intent.target,
      value: formatEther(intent.value),
      calldataHash: intent.calldataHash,
      intentHash: intent.intentHash,
      submittedAt: isoFromChainTime(intent.submittedAt),
      expiresAt: isoFromChainTime(intent.expiresAt),
      executed: intent.executed,
    },
    receipt: {
      decision: decisions[Number(receipt.decision)] ?? `Decision ${receipt.decision.toString()}`,
      policyHash: receipt.policyHash,
      intentHash: receipt.intentHash,
      reasonHash: receipt.reasonHash,
      attestor: receipt.attestor,
      decidedAt: isoFromChainTime(receipt.decidedAt),
      receiptHash: receipt.receiptHash,
      reasonCid: receipt.reasonCid,
    },
    sink: {
      received: formatEther(sinkReceived),
      lastTag: sinkLastTag,
    },
    txs,
  };
}
