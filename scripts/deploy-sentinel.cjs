const fs = require("fs");
const path = require("path");
const solc = require("solc");
const { ethers } = require("ethers");

const envPath = path.resolve(process.cwd(), ".env");
const outputsDir = path.resolve(process.cwd(), "..", "..", "outputs");

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

function compileSentinel() {
  const fileName = "contracts/CovenantSentinelAgent.sol";
  const source = fs.readFileSync(path.resolve(process.cwd(), fileName), "utf8");
  const input = {
    language: "Solidity",
    sources: { [fileName]: { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "shanghai",
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = output.errors || [];
  const fatal = errors.filter((item) => item.severity === "error");
  if (fatal.length > 0) throw new Error(errors.map((item) => item.formattedMessage).join("\n"));
  const artifact = output.contracts[fileName].CovenantSentinelAgent;
  return {
    abi: artifact.abi,
    bytecode: `0x${artifact.evm.bytecode.object}`,
    warnings: errors.filter((item) => item.severity !== "error").map((item) => item.formattedMessage),
  };
}

async function main() {
  loadEnv();
  const rpcUrl = requireEnv("RITUAL_RPC_URL");
  const expectedChainId = BigInt(requireEnv("RITUAL_CHAIN_ID"));
  const privateKey = requireEnv("DEPLOYER_PRIVATE_KEY");
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("DEPLOYER_PRIVATE_KEY format is invalid.");

  const kernelAddress = optionalEnv("COVENANT_KERNEL_ADDRESS", "0x4086710799f9d1Cb1eDb4D0a64522F00A5790270");
  const bountyJudgeAddress = optionalEnv("BOUNTY_JUDGE_ADDRESS", "0xf25720F49d877F4CAD539C6Bf0d2851B5e3Cb809");
  const missionCid = optionalEnv("SENTINEL_MISSION_CID", "ipfs://ritual-covenant/covenant-sentinel-agent");
  if (!ethers.isAddress(kernelAddress)) throw new Error("COVENANT_KERNEL_ADDRESS is invalid.");
  if (!ethers.isAddress(bountyJudgeAddress)) throw new Error("BOUNTY_JUDGE_ADDRESS is invalid.");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const deployer = await wallet.getAddress();
  const network = await provider.getNetwork();
  if (network.chainId !== expectedChainId) throw new Error(`Wrong chain: expected ${expectedChainId}, got ${network.chainId}`);

  const artifact = compileSentinel();
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const deployTx = await factory.getDeployTransaction(kernelAddress, bountyJudgeAddress, missionCid);
  const [balance, feeData, deployGas] = await Promise.all([
    provider.getBalance(deployer),
    provider.getFeeData(),
    provider.estimateGas({ ...deployTx, from: deployer }),
  ]);
  const gasUnitPrice = feeData.gasPrice || feeData.maxFeePerGas || 1_000_000_000n;
  const deployGasCost = deployGas * gasUnitPrice;
  const reserve = ethers.parseEther(optionalEnv("SENTINEL_DEPLOY_RESERVE", "0.02"));
  const dryRun = optionalBool("DRY_RUN", false);

  const preflight = {
    step: dryRun ? "sentinel-deploy-dry-run" : "sentinel-deploy-preflight",
    chainId: network.chainId.toString(),
    deployer,
    kernelAddress,
    bountyJudgeAddress,
    missionCid,
    balance: ethers.formatEther(balance),
    gasUnitPriceGwei: ethers.formatUnits(gasUnitPrice, "gwei"),
    estimatedDeployGas: deployGas.toString(),
    estimatedDeployCost: ethers.formatEther(deployGasCost),
    reserve: ethers.formatEther(reserve),
    warnings: artifact.warnings,
  };
  console.log(JSON.stringify(preflight, null, 2));

  if (balance < deployGasCost + reserve) {
    throw new Error(`Balance too low. Need deploy cost + reserve; have ${ethers.formatEther(balance)} RITUAL.`);
  }
  if (dryRun) return;

  const contract = await factory.deploy(kernelAddress, bountyJudgeAddress, missionCid);
  const receipt = await contract.deploymentTransaction().wait();
  if (receipt.status !== 1) throw new Error(`Sentinel deployment failed: ${receipt.hash}`);
  const sentinelAddress = await contract.getAddress();

  const result = {
    chainId: network.chainId.toString(),
    deployer,
    sentinelAddress,
    deploymentTx: receipt.hash,
    deploymentGasUsed: receipt.gasUsed.toString(),
    kernelAddress,
    bountyJudgeAddress,
    missionCid,
    explorer: `https://explorer.ritualfoundation.org/address/${sentinelAddress}`,
  };

  fs.mkdirSync(outputsDir, { recursive: true });
  const outputPath = path.join(outputsDir, "sentinel-deployment.json");
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

  console.log(JSON.stringify({ status: "SENTINEL_DEPLOYED", outputPath, ...result }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
