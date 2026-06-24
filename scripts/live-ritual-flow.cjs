const fs = require("fs");
const path = require("path");
const solc = require("solc");
const { ethers } = require("ethers");

const projectDir = process.cwd();
const envPath = path.resolve(projectDir, ".env");
const walletEnvPath = path.resolve(projectDir, ".env.wallets");
const outputsDir = path.resolve(projectDir, "..", "..", "outputs");
const deploymentPath = path.join(outputsDir, "ritual-deployment.json");
const liveOutputPath = path.join(outputsDir, "ritual-live-flow.json");
const kernelFallback = "0x4086710799f9d1Cb1eDb4D0a64522F00A5790270";

const sinkSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract RitualValueSink {
    uint256 public received;
    bytes32 public lastTag;
    event Received(address indexed caller, uint256 value, bytes32 tag);

    function receiveValue(bytes32 tag) external payable {
        received += msg.value;
        lastTag = tag;
        emit Received(msg.sender, msg.value, tag);
    }
}
`;

function parseEnvFile(filePath, required = true) {
  if (!fs.existsSync(filePath)) {
    if (required) throw new Error(`Missing ${path.basename(filePath)}`);
    return {};
  }

  const env = {};
  const text = fs.readFileSync(filePath, "utf8");

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals === -1) continue;
    env[line.slice(0, equals).trim()] = line.slice(equals + 1).trim();
  }

  return env;
}

function requireEnv(env, key) {
  const value = env[key] || process.env[key];
  if (!value) throw new Error(`Missing ${key}`);
  return value;
}

function ensureGeneratedWallets() {
  const existing = parseEnvFile(walletEnvPath, false);

  if (existing.AGENT_PRIVATE_KEY && existing.SUCCESSOR_PRIVATE_KEY) {
    return existing;
  }

  const agent = ethers.Wallet.createRandom();
  const successor = ethers.Wallet.createRandom();
  const content = [
    "# Generated local burner wallets for Ritual Covenant live smoke tests.",
    "# Never share these keys. This file is ignored by .gitignore.",
    `AGENT_PRIVATE_KEY=${agent.privateKey}`,
    `SUCCESSOR_PRIVATE_KEY=${successor.privateKey}`,
    "",
  ].join("\n");

  fs.writeFileSync(walletEnvPath, content, { encoding: "utf8", flag: "wx" });

  return {
    AGENT_PRIVATE_KEY: agent.privateKey,
    SUCCESSOR_PRIVATE_KEY: successor.privateKey,
  };
}

function compileSink() {
  const input = {
    language: "Solidity",
    sources: { "contracts/RitualValueSink.sol": { content: sinkSource } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "shanghai",
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = output.errors || [];
  const fatal = errors.filter((item) => item.severity === "error");

  if (fatal.length > 0) {
    throw new Error(errors.map((item) => item.formattedMessage).join("\n"));
  }

  const artifact = output.contracts["contracts/RitualValueSink.sol"].RitualValueSink;
  return {
    abi: artifact.abi,
    bytecode: `0x${artifact.evm.bytecode.object}`,
    warnings: errors.filter((item) => item.severity !== "error").map((item) => item.formattedMessage),
  };
}

async function tx(label, txPromise, txs) {
  const sent = await txPromise;
  const receipt = await sent.wait();

  if (receipt.status !== 1) {
    throw new Error(`${label} failed: ${receipt.hash}`);
  }

  txs.push({ label, hash: receipt.hash, gasUsed: receipt.gasUsed.toString() });
  return receipt;
}

async function fundIfNeeded({ deployer, to, minBalance, targetBalance, label, txs }) {
  const provider = deployer.provider;
  const current = await provider.getBalance(to);

  if (current >= minBalance) {
    return { funded: false, balance: current };
  }

  const amount = targetBalance - current;
  await tx(label, deployer.sendTransaction({ to, value: amount }), txs);
  return { funded: true, balance: await provider.getBalance(to) };
}

async function main() {
  const env = parseEnvFile(envPath);
  const generated = ensureGeneratedWallets();
  const rpcUrl = requireEnv(env, "RITUAL_RPC_URL");
  const expectedChainId = BigInt(requireEnv(env, "RITUAL_CHAIN_ID"));
  const deployerPrivateKey = requireEnv(env, "DEPLOYER_PRIVATE_KEY");

  if (!/^0x[0-9a-fA-F]{64}$/.test(deployerPrivateKey)) {
    throw new Error("DEPLOYER_PRIVATE_KEY format is invalid.");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const deployer = new ethers.Wallet(deployerPrivateKey, provider);
  const agent = new ethers.Wallet(generated.AGENT_PRIVATE_KEY, provider);
  const successor = new ethers.Wallet(generated.SUCCESSOR_PRIVATE_KEY, provider);
  const network = await provider.getNetwork();

  if (network.chainId !== expectedChainId) {
    throw new Error(`Wrong chain: expected ${expectedChainId}, got ${network.chainId}`);
  }

  const kernelAddress = fs.existsSync(deploymentPath)
    ? JSON.parse(fs.readFileSync(deploymentPath, "utf8")).contractAddress || kernelFallback
    : kernelFallback;
  const kernelAbi = [
    "function nextAgentId() view returns (uint256)",
    "function nextCheckId() view returns (uint256)",
    "function agents(uint256) view returns (address owner,address successor,bytes32 policyHash,bytes32 policyCidHash,bytes32 memoryCidHash,uint64 heartbeatAfter,uint64 lastHeartbeat,uint64 cooldownUntil,uint96 bond,uint8 status,string policyCid,string memoryCid)",
    "function registerAgent(address agent, bytes32 policyHash, string cid, address successor) payable returns (uint256)",
    "function submitIntentEnvelope(uint256 agentId,address target,uint256 value,bytes calldata callData,uint64 ttl) returns (uint256)",
    "function recordDecision(uint256 checkId,uint8 decision,string reasonCid) returns (bytes32)",
    "function executeApproved(uint256 checkId, bytes calldata callData) returns (bytes)",
    "function receipts(uint256) view returns (uint256 checkId,uint256 agentId,uint8 decision,bytes32 policyHash,bytes32 intentHash,bytes32 reasonHash,address attestor,uint64 decidedAt,bytes32 receiptHash,string reasonCid)",
  ];
  const kernel = new ethers.Contract(kernelAddress, kernelAbi, deployer);
  const kernelAsAgent = kernel.connect(agent);
  const sinkArtifact = compileSink();
  const sinkFactory = new ethers.ContractFactory(sinkArtifact.abi, sinkArtifact.bytecode, deployer);
  const txs = [];
  const bond = ethers.parseEther(env.AGENT_BOND || "0.05");
  const executionValue = ethers.parseEther(env.EXECUTION_VALUE || "0.005");
  const agentGasTarget = ethers.parseEther(env.AGENT_GAS_TARGET || "0.03");
  const agentGasMinimum = ethers.parseEther(env.AGENT_GAS_MINIMUM || "0.015");
  const deployerBalance = await provider.getBalance(deployer.address);

  console.log(
    JSON.stringify(
      {
        step: "live-preflight",
        chainId: network.chainId.toString(),
        kernelAddress,
        deployer: deployer.address,
        agent: agent.address,
        successor: successor.address,
        deployerBalance: ethers.formatEther(deployerBalance),
        bond: ethers.formatEther(bond),
        executionValue: ethers.formatEther(executionValue),
      },
      null,
      2,
    ),
  );

  if (deployerBalance < ethers.parseEther("0.12")) {
    throw new Error("Deployer balance is too low for safe live smoke test. Need at least ~0.12 RITUAL.");
  }

  await fundIfNeeded({
    deployer,
    to: agent.address,
    minBalance: agentGasMinimum,
    targetBalance: agentGasTarget,
    label: "fund agent gas wallet",
    txs,
  });

  const sink = await sinkFactory.deploy();
  const sinkReceipt = await sink.deploymentTransaction().wait();
  const sinkAddress = await sink.getAddress();
  txs.push({ label: "deploy RitualValueSink", hash: sinkReceipt.hash, gasUsed: sinkReceipt.gasUsed.toString() });

  const agentId = await kernel.nextAgentId();
  const policyCid = env.POLICY_CID || "ipfs://ritual-covenant-live-policy";
  const policyHash = /^0x[0-9a-fA-F]{64}$/.test(env.POLICY_HASH || "")
    ? env.POLICY_HASH
    : ethers.keccak256(ethers.toUtf8Bytes(`${policyCid}|${agent.address}|${successor.address}`));

  await tx(
    "register live agent",
    kernel.registerAgent(agent.address, policyHash, policyCid, successor.address, { value: bond }),
    txs,
  );

  const sinkIface = new ethers.Interface(sinkArtifact.abi);
  const tag = ethers.keccak256(ethers.toUtf8Bytes(`ritual-live-${Date.now()}`));
  const callData = sinkIface.encodeFunctionData("receiveValue", [tag]);
  const checkId = await kernel.nextCheckId();

  await tx(
    "submit executable intent",
    kernelAsAgent.submitIntentEnvelope(agentId, sinkAddress, executionValue, callData, 3600),
    txs,
  );

  await tx(
    "record allowed decision",
    kernel.recordDecision(checkId, 1, "ipfs://ritual-covenant-live-allowed"),
    txs,
  );

  await tx("execute approved intent", kernelAsAgent.executeApproved(checkId, callData), txs);

  const storedAgent = await kernel.agents(agentId);
  const receipt = await kernel.receipts(checkId);
  const sinkContract = new ethers.Contract(sinkAddress, sinkArtifact.abi, provider);
  const sinkReceived = await sinkContract.received();
  const liveResult = {
    status: "PASS",
    chainId: network.chainId.toString(),
    kernelAddress,
    sinkAddress,
    deployer: deployer.address,
    agent: agent.address,
    successor: successor.address,
    agentId: agentId.toString(),
    checkId: checkId.toString(),
    policyHash,
    policyCid,
    bondInitial: ethers.formatEther(bond),
    executionValue: ethers.formatEther(executionValue),
    bondRemaining: ethers.formatEther(storedAgent.bond),
    receiptDecision: receipt.decision.toString(),
    sinkReceived: ethers.formatEther(sinkReceived),
    txs,
    explorer: {
      kernel: `https://explorer.ritualfoundation.org/address/${kernelAddress}`,
      sink: `https://explorer.ritualfoundation.org/address/${sinkAddress}`,
      latestTx: `https://explorer.ritualfoundation.org/tx/${txs[txs.length - 1].hash}`,
    },
  };

  if (sinkReceived !== executionValue) {
    throw new Error("Sink did not receive the approved execution value.");
  }

  if (receipt.decision !== 1n) {
    throw new Error("Decision receipt is not Allowed.");
  }

  fs.mkdirSync(outputsDir, { recursive: true });
  fs.writeFileSync(liveOutputPath, JSON.stringify(liveResult, null, 2));

  console.log(JSON.stringify({ outputPath: liveOutputPath, ...liveResult }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
