const fs = require("fs");
const path = require("path");
const { encrypt, ECIES_CONFIG } = require("eciesjs");
const { ethers } = require("ethers");

ECIES_CONFIG.symmetricNonceLength = 12;

const envPath = path.resolve(process.cwd(), ".env");
const outputsDir = path.resolve(process.cwd(), "..", "..", "outputs");
const deploymentPath = path.join(outputsDir, "sentinel-deployment.json");

const TEE_REGISTRY = "0x9644e8562cE0Fe12b4deeC4163c064A8862Bf47F";
const RITUAL_WALLET = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948";
const ASYNC_TRACKER = "0xC069FFCa0389f44eCA2C626e55491b0ab045AEF5";

const registryAbi = [
  "function getServicesByCapability(uint8 capability,bool checkValidity) view returns (tuple(tuple(address paymentAddress,address teeAddress,uint8 teeType,bytes publicKey,string endpoint,bytes32 certPubKeyHash,uint8 capability) node,bool isValid,bytes32 workloadId)[])",
];
const ritualWalletAbi = [
  "function deposit(uint256 lockDuration) payable",
  "function balanceOf(address user) view returns (uint256)",
  "function lockUntil(address user) view returns (uint256)",
];
const trackerAbi = ["function hasPendingJobForSender(address sender) view returns (bool)"];
const sentinelAbi = [
  "function callSovereignAgent(bytes input) returns (bytes)",
  "event SovereignAgentResultDelivered(bytes32 indexed jobId, bytes result)",
];

function loadEnv() {
  if (!fs.existsSync(envPath)) throw new Error("Missing .env");
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
  return process.env[name]?.trim() || fallback;
}

function optionalBool(name, fallback) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes"].includes(value)) return true;
  if (["0", "false", "no"].includes(value)) return false;
  throw new Error(`${name} must be true or false.`);
}

function readSentinelAddress() {
  const explicit = process.env.SENTINEL_AGENT_ADDRESS?.trim();
  if (explicit) return explicit;
  if (!fs.existsSync(deploymentPath)) {
    throw new Error("Missing sentinel deployment. Run npm run contract:deploy:sentinel first.");
  }
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  return deployment.sentinelAddress;
}

function buildSovereignInput({ executor, publicKey, sentinelAddress, prompt, model, cliType, maxTurns, maxTokens }) {
  const abi = ethers.AbiCoder.defaultAbiCoder();
  const selector = ethers.id("onSovereignAgentResult(bytes32,bytes)").slice(0, 10);
  const secrets = JSON.stringify({ LLM_PROVIDER: "ritual" });
  const encrypted = encrypt(Buffer.from(ethers.getBytes(publicKey)), Buffer.from(secrets, "utf8"));
  const storageRefType = "tuple(string platform,string path,string keyRef)";

  return abi.encode(
    [
      "address",
      "uint256",
      "bytes",
      "uint64",
      "uint64",
      "string",
      "address",
      "bytes4",
      "uint256",
      "uint256",
      "uint256",
      "uint16",
      "string",
      "bytes",
      storageRefType,
      storageRefType,
      `${storageRefType}[]`,
      storageRefType,
      "string",
      "string[]",
      "uint16",
      "uint32",
      "string",
    ],
    [
      executor,
      500n,
      "0x",
      5n,
      6000n,
      "COVENANT_SENTINEL_TASK",
      sentinelAddress,
      selector,
      3_000_000n,
      1_000_000_000n,
      100_000_000n,
      BigInt(cliType),
      prompt,
      `0x${Buffer.from(encrypted).toString("hex")}`,
      ["", "", ""],
      ["", "", ""],
      [],
      ["", "", ""],
      model,
      [],
      maxTurns,
      maxTokens,
      "",
    ],
  );
}

function decodeResult(resultBytes) {
  const abi = ethers.AbiCoder.defaultAbiCoder();
  const storageRefType = "tuple(string platform,string path,string keyRef)";
  const [success, error, text, , , artifacts] = abi.decode(
    ["bool", "string", "string", storageRefType, storageRefType, `${storageRefType}[]`],
    resultBytes,
  );
  return { success, error, text, artifactCount: artifacts.length };
}

async function waitForResult(provider, sentinelAddress, jobHash, fromBlock, timeoutSeconds) {
  const eventTopic = ethers.id("SovereignAgentResultDelivered(bytes32,bytes)");
  const jobTopic = ethers.zeroPadValue(jobHash, 32);
  const started = Date.now();
  while (Date.now() - started < timeoutSeconds * 1000) {
    const logs = await provider.getLogs({
      address: sentinelAddress,
      topics: [eventTopic, jobTopic],
      fromBlock,
      toBlock: "latest",
    });
    if (logs.length > 0) {
      const [wrapped] = ethers.AbiCoder.defaultAbiCoder().decode(["bytes"], logs[0].data);
      return { log: logs[0], decoded: decodeResult(wrapped) };
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return null;
}

async function main() {
  loadEnv();
  const rpcUrl = requireEnv("RITUAL_RPC_URL");
  const expectedChainId = BigInt(requireEnv("RITUAL_CHAIN_ID"));
  const privateKey = requireEnv("DEPLOYER_PRIVATE_KEY");
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("DEPLOYER_PRIVATE_KEY format is invalid.");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const address = await wallet.getAddress();
  const network = await provider.getNetwork();
  if (network.chainId !== expectedChainId) throw new Error(`Wrong chain: expected ${expectedChainId}, got ${network.chainId}`);

  const sentinelAddress = readSentinelAddress();
  if (!ethers.isAddress(sentinelAddress)) throw new Error("SENTINEL_AGENT_ADDRESS is invalid.");

  const registry = new ethers.Contract(TEE_REGISTRY, registryAbi, provider);
  const ritualWallet = new ethers.Contract(RITUAL_WALLET, ritualWalletAbi, wallet);
  const tracker = new ethers.Contract(ASYNC_TRACKER, trackerAbi, provider);
  const sentinel = new ethers.Contract(sentinelAddress, sentinelAbi, wallet);

  const [nativeBalance, walletBalance, pending, services, feeData, fromBlock] = await Promise.all([
    provider.getBalance(address),
    ritualWallet.balanceOf(address),
    tracker.hasPendingJobForSender(address),
    registry.getServicesByCapability(0, true),
    provider.getFeeData(),
    provider.getBlockNumber(),
  ]);

  if (pending) throw new Error("Sender already has a pending async job. Wait or use another funded key.");
  if (services.length === 0) throw new Error("No valid executor found for HTTP_CALL capability.");

  const executorOverride = process.env.EXECUTOR_TEE_ADDRESS?.trim();
  const selectedService = executorOverride
    ? services.find((service) => service.node.teeAddress.toLowerCase() === executorOverride.toLowerCase())
    : services[0];
  if (!selectedService) throw new Error("Requested EXECUTOR_TEE_ADDRESS was not found in valid services.");

  const desiredWalletBalance = ethers.parseEther(optionalEnv("SENTINEL_RITUAL_WALLET_TARGET", "0.1"));
  const lockBlocks = BigInt(optionalEnv("SENTINEL_RITUAL_WALLET_LOCK_BLOCKS", "10000"));
  const dryRun = optionalBool("DRY_RUN", false);
  const model = optionalEnv("SENTINEL_MODEL", "zai-org/GLM-4.7-FP8");
  const cliType = Number(optionalEnv("SENTINEL_CLI_TYPE", "6"));
  const maxTurns = Number(optionalEnv("SENTINEL_MAX_TURNS", "3"));
  const maxTokens = Number(optionalEnv("SENTINEL_MAX_TOKENS", "384"));
  const prompt = optionalEnv(
    "SENTINEL_PROMPT",
    [
      "You are Covenant Sentinel Agent for Ritual Covenant.",
      "Review the on-chain architecture from these addresses.",
      "CovenantKernel: 0x4086710799f9d1Cb1eDb4D0a64522F00A5790270.",
      "CommitRevealBountyJudge: 0xf25720F49d877F4CAD539C6Bf0d2851B5e3Cb809.",
      "Return one concise paragraph explaining what the sentinel watches, why pre-execution policy matters, and what risk it reduces.",
    ].join(" "),
  );

  const input = buildSovereignInput({
    executor: selectedService.node.teeAddress,
    publicKey: selectedService.node.publicKey,
    sentinelAddress,
    prompt,
    model,
    cliType,
    maxTurns,
    maxTokens,
  });
  const callTx = await sentinel.callSovereignAgent.populateTransaction(input);
  const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || 1_000_000_000n;
  const phase1GasLimit = BigInt(optionalEnv("SENTINEL_PHASE1_GAS_LIMIT", "900000"));
  const phase1GasCost = phase1GasLimit * gasPrice;
  const depositNeeded = walletBalance < desiredWalletBalance ? desiredWalletBalance - walletBalance : 0n;
  const reserve = ethers.parseEther(optionalEnv("SENTINEL_RUN_RESERVE", "0.03"));

  const preflight = {
    step: dryRun ? "sentinel-run-dry-run" : "sentinel-run-preflight",
    chainId: network.chainId.toString(),
    sender: address,
    sentinelAddress,
    nativeBalance: ethers.formatEther(nativeBalance),
    ritualWalletBalance: ethers.formatEther(walletBalance),
    ritualWalletTarget: ethers.formatEther(desiredWalletBalance),
    depositNeeded: ethers.formatEther(depositNeeded),
    lockBlocks: lockBlocks.toString(),
    validExecutors: services.length,
    executor: selectedService.node.teeAddress,
    model,
    cliType,
    maxTurns,
    maxTokens,
    requestHash: ethers.keccak256(input),
    phase1GasLimit: phase1GasLimit.toString(),
    estimatedPhase1GasCost: ethers.formatEther(phase1GasCost),
    reserve: ethers.formatEther(reserve),
  };
  console.log(JSON.stringify(preflight, null, 2));

  if (nativeBalance < depositNeeded + phase1GasCost + reserve) {
    throw new Error(
      `Balance too low. Need deposit + phase1 gas + reserve; have ${ethers.formatEther(nativeBalance)} RITUAL.`,
    );
  }
  if (dryRun) return;

  const txs = [];
  if (depositNeeded > 0n) {
    const depositTx = await ritualWallet.deposit(lockBlocks, { value: depositNeeded });
    const depositReceipt = await depositTx.wait();
    if (depositReceipt.status !== 1) throw new Error(`RitualWallet deposit failed: ${depositReceipt.hash}`);
    txs.push({ label: "deposit RitualWallet for sentinel", hash: depositReceipt.hash, gasUsed: depositReceipt.gasUsed.toString() });
    console.log(JSON.stringify(txs[txs.length - 1], null, 2));
  }

  const sent = await wallet.sendTransaction({
    ...callTx,
    gasLimit: phase1GasLimit,
    maxFeePerGas: gasPrice > ethers.parseUnits("20", "gwei") ? gasPrice : ethers.parseUnits("20", "gwei"),
    maxPriorityFeePerGas: ethers.parseUnits("1", "gwei"),
  });
  txs.push({ label: "submit Covenant Sentinel sovereign agent", hash: sent.hash, gasLimit: phase1GasLimit.toString() });
  console.log(JSON.stringify(txs[txs.length - 1], null, 2));

  const timeoutSeconds = Number(optionalEnv("SENTINEL_PHASE2_TIMEOUT", "240"));
  const result = await waitForResult(provider, sentinelAddress, sent.hash, fromBlock, timeoutSeconds);
  const output = {
    status: result?.decoded?.success ? "PASS" : result ? "CALLBACK_DELIVERED_WITH_ERROR" : "PHASE2_PENDING",
    chainId: network.chainId.toString(),
    sender: address,
    sentinelAddress,
    fromBlock,
    txs,
    phase1Tx: sent.hash,
    requestHash: ethers.keccak256(input),
    executor: selectedService.node.teeAddress,
    model,
    cliType,
    maxTurns,
    maxTokens,
    callback: result
      ? {
          txHash: result.log.transactionHash,
          blockNumber: result.log.blockNumber,
          success: result.decoded.success,
          error: result.decoded.error,
          text: result.decoded.text,
          artifactCount: result.decoded.artifactCount,
        }
      : null,
    explorer: {
      sentinel: `https://explorer.ritualfoundation.org/address/${sentinelAddress}`,
      phase1: `https://explorer.ritualfoundation.org/tx/${sent.hash}`,
    },
  };

  fs.mkdirSync(outputsDir, { recursive: true });
  const outputPath = path.join(outputsDir, "sentinel-sovereign-run.json");
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ outputPath, ...output }, null, 2));

  if (output.status !== "PASS") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
