const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const projectDir = process.cwd();
const envPath = path.resolve(projectDir, ".env");
const outputsDir = path.resolve(projectDir, "..", "..", "outputs");
const outputPath = path.join(outputsDir, "guardian-live-flow.json");

const KERNEL_ADDRESS = "0x4086710799f9d1Cb1eDb4D0a64522F00A5790270";
const GUARDIAN_ADDRESS = "0xC5804673c09e0b492bc2371892c8c0270ef0878E";
const SINK_ADDRESS = "0x9da44dc63BDdb225Fd819D18c06fa91C5f94Ff91";

const KERNEL_ABI = [
  "function owner() view returns (address)",
  "function attestors(address) view returns (bool)",
  "function setAttestor(address attestor,bool trusted)",
  "function nextCheckId() view returns (uint256)",
  "function agents(uint256) view returns (address owner,address successor,bytes32 policyHash,bytes32 policyCidHash,bytes32 memoryCidHash,uint64 heartbeatAfter,uint64 lastHeartbeat,uint64 cooldownUntil,uint96 bond,uint8 status,string policyCid,string memoryCid)",
  "function receipts(uint256) view returns (uint256 checkId,uint256 agentId,uint8 decision,bytes32 policyHash,bytes32 intentHash,bytes32 reasonHash,address attestor,uint64 decidedAt,bytes32 receiptHash,string reasonCid)",
];

const GUARDIAN_ABI = [
  "function operator() view returns (address)",
  "function kernel() view returns (address)",
  "function kernelAgentId() view returns (uint256)",
  "function maxIntentValue() view returns (uint256)",
  "function allowedTargets(address) view returns (bool)",
  "function setTargetAllowed(address target,bool allowed)",
  "function registerWithKernel(bytes32 policyHash,string policyCid,address successor) payable returns (uint256)",
  "function submitGuardianIntent(address target,uint256 value,bytes callData,uint64 ttl,string missionCid) returns (uint256)",
  "function previewDecision(uint256 checkId) view returns (uint8 decision,uint8 reasonCode,string reasonCid)",
  "function watchKernelIntent(uint256 checkId) returns (uint8 decision,uint8 reasonCode,bytes32 receiptHash)",
  "function executeGuardianApproved(uint256 checkId,bytes callData) returns (bytes)",
];

const SINK_ABI = [
  "function received() view returns (uint256)",
  "function lastTag() view returns (bytes32)",
  "function receiveValue(bytes32 tag) payable",
];

function loadEnv() {
  if (!fs.existsSync(envPath)) {
    throw new Error("Missing .env");
  }

  const text = fs.readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals === -1) continue;
    const key = line.slice(0, equals).trim();
    const value = line.slice(equals + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function optionalEnv(name, fallback) {
  const value = process.env[name]?.trim();
  return value || fallback;
}

async function sendTx(label, txPromise, txs) {
  const sent = await txPromise;
  const receipt = await sent.wait();

  if (receipt.status !== 1) {
    throw new Error(`${label} failed: ${receipt.hash}`);
  }

  txs.push({
    label,
    hash: receipt.hash,
    gasUsed: receipt.gasUsed.toString(),
  });

  console.log(JSON.stringify({ step: label, hash: receipt.hash, gasUsed: receipt.gasUsed.toString() }, null, 2));
  return receipt;
}

function normalizePolicyHash(value, seed) {
  if (value && /^0x[0-9a-fA-F]{64}$/.test(value)) return value;
  return ethers.keccak256(ethers.toUtf8Bytes(seed));
}

async function main() {
  loadEnv();

  const rpcUrl = requireEnv("RITUAL_RPC_URL");
  const expectedChainId = BigInt(requireEnv("RITUAL_CHAIN_ID"));
  const privateKey = requireEnv("DEPLOYER_PRIVATE_KEY");
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("DEPLOYER_PRIVATE_KEY format is invalid.");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const deployer = await wallet.getAddress();
  const network = await provider.getNetwork();

  if (network.chainId !== expectedChainId) {
    throw new Error(`Wrong chain: expected ${expectedChainId}, got ${network.chainId}`);
  }

  const kernel = new ethers.Contract(KERNEL_ADDRESS, KERNEL_ABI, wallet);
  const guardian = new ethers.Contract(GUARDIAN_ADDRESS, GUARDIAN_ABI, wallet);
  const sink = new ethers.Contract(SINK_ADDRESS, SINK_ABI, provider);

  const [kernelCode, guardianCode, kernelOwner, guardianOperator, guardianKernel, balance, feeData] = await Promise.all([
    provider.getCode(KERNEL_ADDRESS),
    provider.getCode(GUARDIAN_ADDRESS),
    kernel.owner(),
    guardian.operator(),
    guardian.kernel(),
    provider.getBalance(deployer),
    provider.getFeeData(),
  ]);

  if (kernelCode === "0x") throw new Error("Kernel code missing on Ritual testnet.");
  if (guardianCode === "0x") throw new Error("Guardian code missing on Ritual testnet.");
  if (kernelOwner.toLowerCase() !== deployer.toLowerCase()) throw new Error("Deployer is not CovenantKernel owner.");
  if (guardianOperator.toLowerCase() !== deployer.toLowerCase()) throw new Error("Deployer is not Guardian operator.");
  if (guardianKernel.toLowerCase() !== KERNEL_ADDRESS.toLowerCase()) throw new Error("Guardian points at wrong kernel.");

  const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || 1_000_000_000n;
  const bond = ethers.parseEther(optionalEnv("GUARDIAN_BOND", "0.02"));
  const executionValue = ethers.parseEther(optionalEnv("GUARDIAN_EXECUTION_VALUE", "0.001"));
  const policyCid = optionalEnv("GUARDIAN_POLICY_CID", "ipfs://ritual-covenant/guardian-live-policy");
  const missionCid = optionalEnv("GUARDIAN_MISSION_CID", "ipfs://ritual-covenant/guardian-live-mission");
  const policyHash = normalizePolicyHash(process.env.GUARDIAN_POLICY_HASH, `${policyCid}|${GUARDIAN_ADDRESS}|${deployer}`);
  const maxIntentValue = await guardian.maxIntentValue();

  if (executionValue > maxIntentValue) {
    throw new Error(`Execution value ${ethers.formatEther(executionValue)} exceeds Guardian max ${ethers.formatEther(maxIntentValue)}.`);
  }

  console.log(
    JSON.stringify(
      {
        step: "guardian-live-preflight",
        chainId: network.chainId.toString(),
        deployer,
        balance: ethers.formatEther(balance),
        gasPriceGwei: ethers.formatUnits(gasPrice, "gwei"),
        kernelAddress: KERNEL_ADDRESS,
        guardianAddress: GUARDIAN_ADDRESS,
        sinkAddress: SINK_ADDRESS,
        bond: ethers.formatEther(bond),
        executionValue: ethers.formatEther(executionValue),
        maxIntentValue: ethers.formatEther(maxIntentValue),
      },
      null,
      2,
    ),
  );

  if (balance < ethers.parseEther("0.025")) {
    throw new Error("Balance too low for safe Guardian live flow. Need at least 0.025 RITUAL.");
  }

  const txs = [];
  const wasAttestor = await kernel.attestors(GUARDIAN_ADDRESS);
  if (!wasAttestor) {
    await sendTx("trust Guardian as kernel attestor", kernel.setAttestor(GUARDIAN_ADDRESS, true), txs);
  }

  const wasAllowed = await guardian.allowedTargets(SINK_ADDRESS);
  if (!wasAllowed) {
    await sendTx("allow live sink target", guardian.setTargetAllowed(SINK_ADDRESS, true), txs);
  }

  let agentId = await guardian.kernelAgentId();
  if (agentId === 0n) {
    await sendTx("register Guardian with kernel", guardian.registerWithKernel(policyHash, policyCid, deployer, { value: bond }), txs);
    agentId = await guardian.kernelAgentId();
  }

  const sinkIface = new ethers.Interface(SINK_ABI);
  const tag = ethers.keccak256(ethers.toUtf8Bytes(`guardian-live-${Date.now()}`));
  const callData = sinkIface.encodeFunctionData("receiveValue", [tag]);
  const checkId = await kernel.nextCheckId();
  const sinkReceivedBefore = await sink.received();

  await sendTx(
    "submit Guardian intent",
    guardian.submitGuardianIntent(SINK_ADDRESS, executionValue, callData, 3600, missionCid),
    txs,
  );

  const preview = await guardian.previewDecision(checkId);
  if (preview.decision !== 1n) {
    throw new Error(`Guardian preview did not allow intent. decision=${preview.decision} reason=${preview.reasonCode}`);
  }

  await sendTx("watch and record Guardian decision", guardian.watchKernelIntent(checkId), txs);
  await sendTx("execute Guardian approved intent", guardian.executeGuardianApproved(checkId, callData), txs);

  const [agentState, receipt, sinkReceivedAfter, lastTag] = await Promise.all([
    kernel.agents(agentId),
    kernel.receipts(checkId),
    sink.received(),
    sink.lastTag(),
  ]);

  const sinkDelta = sinkReceivedAfter - sinkReceivedBefore;
  if (receipt.decision !== 1n) throw new Error("Kernel receipt was not Allowed.");
  if (sinkDelta !== executionValue) throw new Error("Sink did not receive the Guardian execution value.");
  if (lastTag !== tag) throw new Error("Sink tag mismatch after Guardian execution.");

  const result = {
    status: "PASS",
    chainId: network.chainId.toString(),
    kernelAddress: KERNEL_ADDRESS,
    guardianAddress: GUARDIAN_ADDRESS,
    sinkAddress: SINK_ADDRESS,
    deployer,
    agentId: agentId.toString(),
    checkId: checkId.toString(),
    policyHash,
    policyCid,
    missionCid,
    executionValue: ethers.formatEther(executionValue),
    guardianBondRemaining: ethers.formatEther(agentState.bond),
    receiptDecision: receipt.decision.toString(),
    receiptHash: receipt.receiptHash,
    reasonCid: receipt.reasonCid,
    sinkDelta: ethers.formatEther(sinkDelta),
    txs,
    explorer: {
      guardian: `https://explorer.ritualfoundation.org/address/${GUARDIAN_ADDRESS}`,
      latestTx: `https://explorer.ritualfoundation.org/tx/${txs[txs.length - 1].hash}`,
    },
  };

  fs.mkdirSync(outputsDir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

  console.log(JSON.stringify({ outputPath, ...result }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
