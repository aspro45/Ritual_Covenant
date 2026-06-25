const fs = require("fs");
const path = require("path");
const { encrypt, ECIES_CONFIG } = require("eciesjs");
const { ethers } = require("ethers");

ECIES_CONFIG.symmetricNonceLength = 12;

const envPath = path.resolve(process.cwd(), ".env");
const outputsDir = path.resolve(process.cwd(), "..", "..", "outputs");

const SOVEREIGN_FACTORY = "0x9dC4C054e53bCc4Ce0A0Ff09E890A7a8e817f304";
const TEE_REGISTRY = "0x9644e8562cE0Fe12b4deeC4163c064A8862Bf47F";
const RITUAL_WALLET = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948";
const ASYNC_DELIVERY_SELECTOR = "onSovereignAgentResult(bytes32,bytes)";

const storageRefTuple = {
  type: "tuple",
  components: [
    { name: "platform", type: "string" },
    { name: "path", type: "string" },
    { name: "keyRef", type: "string" },
  ],
};

const paramsTuple = {
  name: "params",
  type: "tuple",
  components: [
    { name: "executor", type: "address" },
    { name: "ttl", type: "uint256" },
    { name: "userPublicKey", type: "bytes" },
    { name: "pollIntervalBlocks", type: "uint64" },
    { name: "maxPollBlock", type: "uint64" },
    { name: "taskIdMarker", type: "string" },
    { name: "deliveryTarget", type: "address" },
    { name: "deliverySelector", type: "bytes4" },
    { name: "deliveryGasLimit", type: "uint256" },
    { name: "deliveryMaxFeePerGas", type: "uint256" },
    { name: "deliveryMaxPriorityFeePerGas", type: "uint256" },
    { name: "cliType", type: "uint16" },
    { name: "prompt", type: "string" },
    { name: "encryptedSecrets", type: "bytes" },
    { ...storageRefTuple, name: "convoHistory" },
    { ...storageRefTuple, name: "output" },
    { name: "skills", type: "tuple[]", components: storageRefTuple.components },
    { ...storageRefTuple, name: "systemPrompt" },
    { name: "model", type: "string" },
    { name: "tools", type: "string[]" },
    { name: "maxTurns", type: "uint16" },
    { name: "maxTokens", type: "uint32" },
    { name: "rpcUrls", type: "string" },
  ],
};

const scheduleTuple = {
  name: "schedule",
  type: "tuple",
  components: [
    { name: "schedulerGas", type: "uint32" },
    { name: "frequency", type: "uint32" },
    { name: "schedulerTtl", type: "uint32" },
    { name: "maxFeePerGas", type: "uint256" },
    { name: "maxPriorityFeePerGas", type: "uint256" },
    { name: "value", type: "uint256" },
  ],
};

const rollingTuple = {
  name: "rolling",
  type: "tuple",
  components: [
    { name: "windowNumCalls", type: "uint32" },
    { name: "rolloverThresholdBps", type: "uint16" },
    { name: "rolloverRetryEveryCalls", type: "uint16" },
  ],
};

const factoryAbi = [
  {
    name: "deployHarness",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "userSalt", type: "bytes32" }],
    outputs: [{ name: "harness", type: "address" }],
  },
  {
    name: "predictHarness",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "userSalt", type: "bytes32" },
    ],
    outputs: [
      { name: "harness", type: "address" },
      { name: "childSalt", type: "bytes32" },
    ],
  },
  "event HarnessDeployed(address indexed owner, bytes32 indexed userSalt, bytes32 indexed childSalt, address harness)",
];

const harnessAbi = [
  {
    name: "configureFundAndStart",
    type: "function",
    stateMutability: "payable",
    inputs: [paramsTuple, scheduleTuple, rollingTuple, { name: "schedulerLockDuration", type: "uint256" }],
    outputs: [{ name: "schedulerCallId", type: "uint256" }],
  },
  "function owner() view returns (address)",
  "function configured() view returns (bool)",
  "function wakeMode() view returns (uint8)",
  "function activeCallId() view returns (uint256)",
  "function activeNumCalls() view returns (uint32)",
  "function currentSeriesId() view returns (uint64)",
  "function stop()",
  "event SovereignStarted(uint64 indexed seriesId, uint256 indexed schedulerCallId, uint32 numCalls)",
];

const registryAbi = [
  {
    name: "getServicesByCapability",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "capability", type: "uint8" },
      { name: "checkValidity", type: "bool" },
    ],
    outputs: [
      {
        type: "tuple[]",
        components: [
          {
            name: "node",
            type: "tuple",
            components: [
              { name: "paymentAddress", type: "address" },
              { name: "teeAddress", type: "address" },
              { name: "teeType", type: "uint8" },
              { name: "publicKey", type: "bytes" },
              { name: "endpoint", type: "string" },
              { name: "certPubKeyHash", type: "bytes32" },
              { name: "capability", type: "uint8" },
            ],
          },
          { name: "isValid", type: "bool" },
          { name: "workloadId", type: "bytes32" },
        ],
      },
    ],
  },
];

const ritualWalletAbi = ["function balanceOf(address user) view returns (uint256)"];

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

function optionalInt(name, fallback) {
  const raw = optionalEnv(name, String(fallback));
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer.`);
  return value;
}

function parseEthEnv(name, fallback) {
  return ethers.parseEther(optionalEnv(name, fallback));
}

function validateBytes32(value, name) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} must be a bytes32 hex string.`);
}

function buildSalt(owner) {
  const explicit = process.env.SOVEREIGN_HARNESS_SALT?.trim();
  if (explicit) {
    validateBytes32(explicit, "SOVEREIGN_HARNESS_SALT");
    return explicit;
  }
  const label = optionalEnv("SOVEREIGN_SALT_LABEL", `ritual-covenant-sovereign-agent:${owner.toLowerCase()}:v1`);
  return ethers.id(label);
}

function buildSecrets(provider, hfToken) {
  const secrets = { LLM_PROVIDER: provider };
  if (provider === "gemini") secrets.GEMINI_API_KEY = requireEnv("GEMINI_API_KEY");
  if (provider === "openai") secrets.OPENAI_API_KEY = requireEnv("OPENAI_API_KEY");
  if (provider === "anthropic") secrets.ANTHROPIC_API_KEY = requireEnv("ANTHROPIC_API_KEY");
  if (provider === "openrouter") secrets.OPENROUTER_API_KEY = requireEnv("OPENROUTER_API_KEY");
  if (hfToken) secrets.HF_TOKEN = hfToken;
  return JSON.stringify(secrets);
}

function buildStorageRefs() {
  const hfToken = process.env.HF_TOKEN?.trim();
  const hfRepo = process.env.HF_REPO_ID?.trim();
  if (hfToken || hfRepo) {
    if (!hfToken || !hfRepo) throw new Error("HF_TOKEN and HF_REPO_ID must be set together.");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(hfRepo)) {
      throw new Error("HF_REPO_ID must look like user/repo.");
    }
    return {
      daMode: "hf",
      hfToken,
      hfRepo,
      convoHistory: { platform: "hf", path: `${hfRepo}/sessions/covenant-sentinel.jsonl`, keyRef: "HF_TOKEN" },
      output: { platform: "hf", path: `${hfRepo}/artifacts/`, keyRef: "HF_TOKEN" },
      systemPrompt: { platform: "", path: "", keyRef: "" },
    };
  }
  return {
    daMode: "empty",
    hfToken: "",
    hfRepo: "",
    convoHistory: { platform: "", path: "", keyRef: "" },
    output: { platform: "", path: "", keyRef: "" },
    systemPrompt: { platform: "", path: "", keyRef: "" },
  };
}

async function validateHfIfPresent(refs) {
  if (refs.daMode !== "hf") return { checked: false };
  const res = await fetch("https://huggingface.co/api/whoami-v2", {
    headers: { authorization: `Bearer ${refs.hfToken}` },
  });
  if (!res.ok) throw new Error(`HF_TOKEN validation failed with HTTP ${res.status}.`);
  const repoRes = await fetch(`https://huggingface.co/api/datasets/${refs.hfRepo}`, {
    headers: { authorization: `Bearer ${refs.hfToken}` },
  });
  if (!repoRes.ok) {
    throw new Error(`HF_REPO_ID validation failed with HTTP ${repoRes.status}. Create the dataset repo first or fix HF_REPO_ID.`);
  }
  return { checked: true, repo: refs.hfRepo };
}

async function validateGeminiIfSelected(provider, model) {
  if (provider !== "gemini") return { checked: false };
  const key = requireEnv("GEMINI_API_KEY");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: "Return only: ok" }] }] }),
  });
  if (!res.ok) throw new Error(`GEMINI_API_KEY/model validation failed with HTTP ${res.status}.`);
  return { checked: true, model };
}

async function main() {
  loadEnv();
  const rpcUrl = requireEnv("RITUAL_RPC_URL");
  const expectedChainId = BigInt(requireEnv("RITUAL_CHAIN_ID"));
  const privateKey = requireEnv("DEPLOYER_PRIVATE_KEY");
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("DEPLOYER_PRIVATE_KEY format is invalid.");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const owner = await wallet.getAddress();
  const network = await provider.getNetwork();
  if (network.chainId !== expectedChainId) throw new Error(`Wrong chain: expected ${expectedChainId}, got ${network.chainId}`);

  const dryRun = optionalBool("DRY_RUN", false);
  const providerName = optionalEnv("SOVEREIGN_LLM_PROVIDER", "ritual").toLowerCase();
  if (!["ritual", "gemini", "openai", "anthropic", "openrouter"].includes(providerName)) {
    throw new Error("SOVEREIGN_LLM_PROVIDER must be ritual, gemini, openai, anthropic, or openrouter.");
  }
  const model = optionalEnv("SOVEREIGN_MODEL", providerName === "ritual" ? "zai-org/GLM-4.7-FP8" : "gemini-2.5-flash");
  const refs = buildStorageRefs();

  const [hfCheck, llmCheck] = await Promise.all([
    validateHfIfPresent(refs),
    validateGeminiIfSelected(providerName, model),
  ]);

  const factory = new ethers.Contract(SOVEREIGN_FACTORY, factoryAbi, wallet);
  const registry = new ethers.Contract(TEE_REGISTRY, registryAbi, provider);
  const ritualWallet = new ethers.Contract(RITUAL_WALLET, ritualWalletAbi, provider);

  const [factoryCode, nativeBalance, services, feeData] = await Promise.all([
    provider.getCode(SOVEREIGN_FACTORY),
    provider.getBalance(owner),
    registry.getServicesByCapability(0, true),
    provider.getFeeData(),
  ]);
  if (factoryCode === "0x") throw new Error("SovereignAgentFactory has no bytecode at expected address.");
  if (services.length === 0) throw new Error("No valid HTTP_CALL executor found in TEEServiceRegistry.");

  const executorOverride = process.env.EXECUTOR_TEE_ADDRESS?.trim();
  const selectedService = executorOverride
    ? services.find((service) => service.node.teeAddress.toLowerCase() === executorOverride.toLowerCase())
    : services[0];
  if (!selectedService) throw new Error("Requested EXECUTOR_TEE_ADDRESS was not found among valid services.");

  const userSalt = buildSalt(owner);
  const [predictedHarness, childSalt] = await factory.predictHarness(owner, userSalt);
  const harnessAddress = ethers.getAddress(predictedHarness);
  const harnessCode = await provider.getCode(harnessAddress);
  const harness = new ethers.Contract(harnessAddress, harnessAbi, wallet);

  const funding = parseEthEnv("SOVEREIGN_FUNDING", "0.5");
  const reserve = parseEthEnv("SOVEREIGN_NATIVE_RESERVE", "0.25");
  const deployGasLimit = BigInt(optionalEnv("SOVEREIGN_DEPLOY_GAS_LIMIT", "3000000"));
  const configureGasLimit = BigInt(optionalEnv("SOVEREIGN_CONFIGURE_GAS_LIMIT", "5000000"));
  const gasPrice = feeData.gasPrice || ethers.parseUnits("1", "gwei");
  const gasReserve = (deployGasLimit + configureGasLimit) * gasPrice;
  if (nativeBalance < funding + reserve + gasReserve) {
    throw new Error(
      `Balance too low for funding + reserve + gas. Have ${ethers.formatEther(nativeBalance)} RITUAL.`,
    );
  }

  const secretsJson = buildSecrets(providerName, refs.hfToken);
  const encryptedSecrets = `0x${Buffer.from(
    encrypt(Buffer.from(ethers.getBytes(selectedService.node.publicKey)), Buffer.from(secretsJson, "utf8")),
  ).toString("hex")}`;

  const maxFeePerGas = ethers.parseUnits(optionalEnv("SOVEREIGN_MAX_FEE_GWEI", "20"), "gwei");
  const priorityFee = ethers.parseUnits(optionalEnv("SOVEREIGN_PRIORITY_FEE_GWEI", "2"), "gwei");
  const prompt = optionalEnv(
    "SOVEREIGN_PROMPT",
    [
      "You are Covenant Sentinel, a sovereign Ritual agent for the Ritual Covenant project.",
      "Watch the on-chain policy firewall, commit-reveal judge, and guardian flow.",
      "Return a concise status note explaining what risk the project reduces and why pre-execution policy checks matter.",
    ].join(" "),
  );

  const params = {
    executor: selectedService.node.teeAddress,
    ttl: 500n,
    userPublicKey: "0x",
    pollIntervalBlocks: 5n,
    maxPollBlock: 6000n,
    taskIdMarker: "COVENANT_SENTINEL_SOVEREIGN_TASK",
    deliveryTarget: harnessAddress,
    deliverySelector: ethers.id(ASYNC_DELIVERY_SELECTOR).slice(0, 10),
    deliveryGasLimit: 3_000_000n,
    deliveryMaxFeePerGas: ethers.parseUnits("1", "gwei"),
    deliveryMaxPriorityFeePerGas: ethers.parseUnits("0.1", "gwei"),
    cliType: optionalInt("SOVEREIGN_CLI_TYPE", 6),
    prompt,
    encryptedSecrets,
    convoHistory: refs.convoHistory,
    output: refs.output,
    skills: [],
    systemPrompt: refs.systemPrompt,
    model,
    tools: [],
    maxTurns: optionalInt("SOVEREIGN_MAX_TURNS", 3),
    maxTokens: optionalInt("SOVEREIGN_MAX_TOKENS", 384),
    rpcUrls: "",
  };

  const schedule = {
    schedulerGas: optionalInt("SOVEREIGN_SCHEDULER_GAS", 3_000_000),
    frequency: optionalInt("SOVEREIGN_FREQUENCY", 180),
    schedulerTtl: optionalInt("SOVEREIGN_SCHEDULER_TTL", 500),
    maxFeePerGas,
    maxPriorityFeePerGas: priorityFee,
    value: 0n,
  };
  const rolling = {
    windowNumCalls: optionalInt("SOVEREIGN_WINDOW_CALLS", 1),
    rolloverThresholdBps: optionalInt("SOVEREIGN_ROLLOVER_BPS", 5000),
    rolloverRetryEveryCalls: optionalInt("SOVEREIGN_ROLLOVER_RETRY_EVERY", 1),
  };
  if (schedule.frequency * rolling.windowNumCalls > 10_000) {
    throw new Error("frequency * windowNumCalls must be <= 10000.");
  }
  const lockDuration = BigInt(optionalEnv("SOVEREIGN_LOCK_DURATION", "100000"));

  const preflight = {
    step: dryRun ? "sovereign-agent-dry-run" : "sovereign-agent-preflight",
    owner,
    chainId: network.chainId.toString(),
    nativeBalance: ethers.formatEther(nativeBalance),
    factory: SOVEREIGN_FACTORY,
    userSalt,
    childSalt,
    harness: harnessAddress,
    harnessAlreadyDeployed: harnessCode !== "0x",
    executor: selectedService.node.teeAddress,
    validExecutors: services.length,
    provider: providerName,
    model,
    daMode: refs.daMode,
    hfChecked: hfCheck.checked,
    llmChecked: llmCheck.checked,
    funding: ethers.formatEther(funding),
    frequency: schedule.frequency,
    windowNumCalls: rolling.windowNumCalls,
    maxTurns: params.maxTurns,
    maxTokens: params.maxTokens,
  };
  console.log(JSON.stringify(preflight, null, 2));

  if (dryRun) return;

  let harnessDeployTx = null;
  if (harnessCode === "0x") {
    const deployTx = await factory.deployHarness(userSalt, {
      gasLimit: deployGasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas: priorityFee,
    });
    console.log(JSON.stringify({ label: "deploy SovereignAgentHarness", hash: deployTx.hash }, null, 2));
    const deployReceipt = await deployTx.wait();
    if (deployReceipt.status !== 1) throw new Error(`Harness deploy failed: ${deployReceipt.hash}`);
    harnessDeployTx = { hash: deployReceipt.hash, gasUsed: deployReceipt.gasUsed.toString() };
  }

  const [harnessOwner, configured, wakeMode] = await Promise.all([
    harness.owner(),
    harness.configured(),
    harness.wakeMode(),
  ]);
  if (harnessOwner.toLowerCase() !== owner.toLowerCase()) {
    throw new Error(`Harness owner mismatch: expected ${owner}, got ${harnessOwner}.`);
  }
  if (configured && Number(wakeMode) !== 0) {
    throw new Error("Harness is already running. Stop it before reconfiguring.");
  }

  const simulatedCallId = await harness.configureFundAndStart.staticCall(params, schedule, rolling, lockDuration, {
    value: funding,
    gasLimit: configureGasLimit,
  });
  console.log(JSON.stringify({ label: "simulation passed", schedulerCallId: simulatedCallId.toString() }, null, 2));

  const startTx = await harness.configureFundAndStart(params, schedule, rolling, lockDuration, {
    value: funding,
    gasLimit: configureGasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas: priorityFee,
  });
  console.log(JSON.stringify({ label: "start scheduled Sovereign Agent", hash: startTx.hash }, null, 2));
  const startReceipt = await startTx.wait();
  if (startReceipt.status !== 1) throw new Error(`Sovereign agent start failed: ${startReceipt.hash}`);

  const [finalConfigured, finalWakeMode, activeCallId, activeNumCalls, currentSeriesId, harnessWalletBalance] =
    await Promise.all([
      harness.configured(),
      harness.wakeMode(),
      harness.activeCallId(),
      harness.activeNumCalls(),
      harness.currentSeriesId(),
      ritualWallet.balanceOf(harnessAddress),
    ]);

  const result = {
    status: "SOVEREIGN_AGENT_STARTED",
    chainId: network.chainId.toString(),
    owner,
    harness: harnessAddress,
    harnessDeployTx,
    startTx: startReceipt.hash,
    startGasUsed: startReceipt.gasUsed.toString(),
    executor: selectedService.node.teeAddress,
    provider: providerName,
    model,
    daMode: refs.daMode,
    funding: ethers.formatEther(funding),
    harnessRitualWalletBalance: ethers.formatEther(harnessWalletBalance),
    configured: finalConfigured,
    wakeMode: finalWakeMode.toString(),
    activeCallId: activeCallId.toString(),
    activeNumCalls: activeNumCalls.toString(),
    currentSeriesId: currentSeriesId.toString(),
    explorer: `https://explorer.ritualfoundation.org/agents/${harnessAddress}?type=sovereign`,
  };
  fs.mkdirSync(outputsDir, { recursive: true });
  const outputPath = path.join(outputsDir, "sovereign-agent-start.json");
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ outputPath, ...result }, null, 2));
}

main().catch((error) => {
  console.error(error.shortMessage || error.message || error);
  process.exit(1);
});
