const fs = require("fs");
const path = require("path");
const solc = require("solc");
const { ethers } = require("ethers");

const envPath = path.resolve(process.cwd(), ".env");
const outputsDir = path.resolve(process.cwd(), "..", "..", "outputs");

function loadEnv() {
  if (!fs.existsSync(envPath)) {
    throw new Error("Missing .env. Copy .env.example to .env and fill DEPLOYER_PRIVATE_KEY.");
  }

  const text = fs.readFileSync(envPath, "utf8");

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals === -1) continue;
    const key = line.slice(0, equals).trim();
    const value = line.slice(equals + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

function optionalEnv(name, fallback) {
  const value = process.env[name]?.trim();
  return value || fallback;
}

function optionalBool(name, fallback) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes"].includes(value)) return true;
  if (["0", "false", "no"].includes(value)) return false;
  throw new Error(`${name} must be true or false.`);
}

function validatePrivateKey(privateKey) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("DEPLOYER_PRIVATE_KEY must start with 0x and contain exactly 64 hex chars after it.");
  }
}

function compileGuardian() {
  const source = fs.readFileSync(path.resolve(process.cwd(), "contracts", "CovenantGuardianAgent.sol"), "utf8");
  const input = {
    language: "Solidity",
    sources: {
      "contracts/CovenantGuardianAgent.sol": { content: source },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "shanghai",
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"],
        },
      },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = output.errors || [];
  const fatal = errors.filter((item) => item.severity === "error");

  if (fatal.length > 0) {
    throw new Error(errors.map((item) => item.formattedMessage).join("\n"));
  }

  const artifact = output.contracts["contracts/CovenantGuardianAgent.sol"].CovenantGuardianAgent;
  return {
    abi: artifact.abi,
    bytecode: `0x${artifact.evm.bytecode.object}`,
    warnings: errors.filter((item) => item.severity !== "error").map((item) => item.formattedMessage),
  };
}

function normalizeBytes32(value, fallbackSeed) {
  const trimmed = value?.trim();
  if (trimmed && /^0x[0-9a-fA-F]{64}$/.test(trimmed)) return trimmed;
  return ethers.keccak256(ethers.toUtf8Bytes(trimmed || fallbackSeed));
}

async function main() {
  loadEnv();

  const rpcUrl = requireEnv("RITUAL_RPC_URL");
  const expectedChainId = BigInt(requireEnv("RITUAL_CHAIN_ID"));
  const privateKey = requireEnv("DEPLOYER_PRIVATE_KEY");
  validatePrivateKey(privateKey);

  const kernelAddress = optionalEnv("COVENANT_KERNEL_ADDRESS", optionalEnv("VITE_COVENANT_KERNEL_ADDRESS", "0x4086710799f9d1Cb1eDb4D0a64522F00A5790270"));
  if (!ethers.isAddress(kernelAddress)) throw new Error("COVENANT_KERNEL_ADDRESS must be a valid address.");

  const purposeCid = optionalEnv("GUARDIAN_PURPOSE_CID", "ipfs://ritual-covenant/guardian-purpose");
  const purposeHash = normalizeBytes32(process.env.GUARDIAN_PURPOSE_HASH, purposeCid);
  const maxIntentValue = ethers.parseEther(optionalEnv("GUARDIAN_MAX_INTENT_VALUE", "0.01"));
  const requireTargetAllowlist = optionalBool("GUARDIAN_REQUIRE_TARGET_ALLOWLIST", true);
  const dryRun = optionalBool("DRY_RUN", false);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const deployer = await wallet.getAddress();
  const network = await provider.getNetwork();

  if (network.chainId !== expectedChainId) {
    throw new Error(`Wrong chain. Expected ${expectedChainId}, RPC returned ${network.chainId}.`);
  }

  const kernelCode = await provider.getCode(kernelAddress);
  if (kernelCode === "0x") throw new Error(`No contract code at COVENANT_KERNEL_ADDRESS ${kernelAddress}.`);

  const artifact = compileGuardian();
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const deployTx = await factory.getDeployTransaction(
    kernelAddress,
    purposeHash,
    purposeCid,
    maxIntentValue,
    requireTargetAllowlist,
  );
  const [balance, feeData, deployGas] = await Promise.all([
    provider.getBalance(deployer),
    provider.getFeeData(),
    provider.estimateGas({ ...deployTx, from: deployer }),
  ]);
  const gasUnitPrice = feeData.gasPrice || feeData.maxFeePerGas || 1_000_000_000n;
  const deployGasCost = deployGas * gasUnitPrice;
  const reserve = ethers.parseEther(optionalEnv("DEPLOY_RESERVE", "0.01"));

  const preflight = {
    step: dryRun ? "guardian-preflight-dry-run" : "guardian-preflight",
    chainId: network.chainId.toString(),
    deployer,
    kernelAddress,
    purposeHash,
    purposeCid,
    maxIntentValue: ethers.formatEther(maxIntentValue),
    requireTargetAllowlist,
    balance: ethers.formatEther(balance),
    gasUnitPriceGwei: ethers.formatUnits(gasUnitPrice, "gwei"),
    estimatedDeployGas: deployGas.toString(),
    estimatedDeployCost: ethers.formatEther(deployGasCost),
    reserve: ethers.formatEther(reserve),
    warnings: artifact.warnings,
  };

  console.log(JSON.stringify(preflight, null, 2));

  if (balance < deployGasCost + reserve) {
    throw new Error(`Balance too low. Need deploy cost + reserve; have ${ethers.formatEther(balance)}.`);
  }

  if (dryRun) {
    return;
  }

  const guardian = await factory.deploy(kernelAddress, purposeHash, purposeCid, maxIntentValue, requireTargetAllowlist);
  const receipt = await guardian.deploymentTransaction().wait();
  const guardianAddress = await guardian.getAddress();

  const result = {
    chainId: network.chainId.toString(),
    deployer,
    kernelAddress,
    guardianAddress,
    deploymentTx: receipt.hash,
    deploymentGasUsed: receipt.gasUsed.toString(),
    purposeHash,
    purposeCid,
    maxIntentValue: ethers.formatEther(maxIntentValue),
    requireTargetAllowlist,
    explorer: `https://explorer.ritualfoundation.org/address/${guardianAddress}`,
  };

  fs.mkdirSync(outputsDir, { recursive: true });
  const outputPath = path.join(outputsDir, "guardian-deployment.json");
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

  console.log(JSON.stringify({ status: "GUARDIAN_DEPLOYED", outputPath, ...result }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
