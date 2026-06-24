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

function compileBountyJudge() {
  const source = fs.readFileSync(path.resolve(process.cwd(), "contracts", "CommitRevealBountyJudge.sol"), "utf8");
  const input = {
    language: "Solidity",
    sources: {
      "contracts/CommitRevealBountyJudge.sol": { content: source },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "shanghai",
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"],
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

  const artifact = output.contracts["contracts/CommitRevealBountyJudge.sol"].CommitRevealBountyJudge;
  return {
    abi: artifact.abi,
    bytecode: `0x${artifact.evm.bytecode.object}`,
    bytecodeBytes: artifact.evm.bytecode.object.length / 2,
    deployedBytecodeBytes: artifact.evm.deployedBytecode.object.length / 2,
    warnings: errors.filter((item) => item.severity !== "error").map((item) => item.formattedMessage),
  };
}

async function main() {
  loadEnv();

  const rpcUrl = requireEnv("RITUAL_RPC_URL");
  const expectedChainId = BigInt(requireEnv("RITUAL_CHAIN_ID"));
  const privateKey = requireEnv("DEPLOYER_PRIVATE_KEY");
  validatePrivateKey(privateKey);

  const dryRun = optionalBool("DRY_RUN", false);
  const reserve = ethers.parseEther(optionalEnv("BOUNTY_DEPLOY_RESERVE", optionalEnv("DEPLOY_RESERVE", "0.005")));

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const deployer = await wallet.getAddress();
  const network = await provider.getNetwork();

  if (network.chainId !== expectedChainId) {
    throw new Error(`Wrong chain. Expected ${expectedChainId}, RPC returned ${network.chainId}.`);
  }

  const artifact = compileBountyJudge();
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const deployTx = await factory.getDeployTransaction();
  const [balance, feeData, deployGas] = await Promise.all([
    provider.getBalance(deployer),
    provider.getFeeData(),
    provider.estimateGas({ ...deployTx, from: deployer }),
  ]);
  const gasUnitPrice = feeData.gasPrice || feeData.maxFeePerGas || 1_000_000_000n;
  const deployGasCost = deployGas * gasUnitPrice;

  const preflight = {
    step: dryRun ? "bounty-preflight-dry-run" : "bounty-preflight",
    chainId: network.chainId.toString(),
    deployer,
    balance: ethers.formatEther(balance),
    gasUnitPriceGwei: ethers.formatUnits(gasUnitPrice, "gwei"),
    estimatedDeployGas: deployGas.toString(),
    estimatedDeployCost: ethers.formatEther(deployGasCost),
    reserve: ethers.formatEther(reserve),
    bytecodeBytes: artifact.bytecodeBytes,
    deployedBytecodeBytes: artifact.deployedBytecodeBytes,
    warnings: artifact.warnings,
  };

  console.log(JSON.stringify(preflight, null, 2));

  if (balance < deployGasCost + reserve) {
    throw new Error(`Balance too low. Need deploy cost + reserve; have ${ethers.formatEther(balance)}.`);
  }

  if (dryRun) {
    return;
  }

  const contract = await factory.deploy();
  const receipt = await contract.deploymentTransaction().wait();
  const contractAddress = await contract.getAddress();
  const code = await provider.getCode(contractAddress);

  const result = {
    status: "BOUNTY_JUDGE_DEPLOYED",
    chainId: network.chainId.toString(),
    deployer,
    contractAddress,
    deploymentTx: receipt.hash,
    deploymentGasUsed: receipt.gasUsed.toString(),
    owner: await contract.owner(),
    nextBountyId: (await contract.nextBountyId()).toString(),
    ownerIsJudge: await contract.judges(deployer),
    codeBytes: code === "0x" ? 0 : (code.length - 2) / 2,
    explorer: `https://explorer.ritualfoundation.org/address/${contractAddress}`,
  };

  fs.mkdirSync(outputsDir, { recursive: true });
  const outputPath = path.join(outputsDir, "bounty-judge-deployment.json");
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

  console.log(JSON.stringify({ outputPath, ...result }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
