const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const envPath = path.resolve(process.cwd(), ".env");
const outputsDir = path.resolve(process.cwd(), "..", "..", "outputs");
const SOVEREIGN_FACTORY = "0x9dC4C054e53bCc4Ce0A0Ff09E890A7a8e817f304";

const factoryAbi = [
  "function predictHarness(address owner, bytes32 userSalt) view returns (address harness, bytes32 childSalt)",
  "function deployHarness(bytes32 userSalt) returns (address harness)",
  "event HarnessDeployed(address indexed owner, bytes32 indexed userSalt, bytes32 indexed childSalt, address harness)",
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

function buildSalt() {
  const explicit = process.env.SOVEREIGN_HARNESS_SALT?.trim();
  if (explicit) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(explicit)) throw new Error("SOVEREIGN_HARNESS_SALT must be bytes32.");
    return explicit;
  }
  return ethers.hexlify(ethers.randomBytes(32));
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

  const factoryCode = await provider.getCode(SOVEREIGN_FACTORY);
  if (factoryCode === "0x") throw new Error("SovereignAgentFactory has no bytecode at expected address.");

  const factory = new ethers.Contract(SOVEREIGN_FACTORY, factoryAbi, wallet);
  const userSalt = buildSalt();
  const [predictedHarness, childSalt] = await factory.predictHarness(owner, userSalt);
  const gasLimit = BigInt(optionalEnv("SOVEREIGN_HARNESS_GAS_LIMIT", "800000"));
  const maxFeePerGas = ethers.parseUnits(optionalEnv("SOVEREIGN_HARNESS_MAX_FEE_GWEI", "2"), "gwei");
  const maxPriorityFeePerGas = ethers.parseUnits(optionalEnv("SOVEREIGN_HARNESS_PRIORITY_FEE_GWEI", "0.2"), "gwei");
  const dryRun = optionalBool("DRY_RUN", false);
  const balance = await provider.getBalance(owner);

  const preflight = {
    step: dryRun ? "sovereign-harness-dry-run" : "sovereign-harness-preflight",
    chainId: network.chainId.toString(),
    owner,
    factory: SOVEREIGN_FACTORY,
    userSalt,
    childSalt,
    predictedHarness,
    balance: ethers.formatEther(balance),
    gasLimit: gasLimit.toString(),
    maxFeePerGasGwei: ethers.formatUnits(maxFeePerGas, "gwei"),
  };
  console.log(JSON.stringify(preflight, null, 2));
  if (balance < gasLimit * maxFeePerGas) throw new Error("Balance too low for harness deploy gas cap.");
  if (dryRun) return;

  const tx = await factory.deployHarness(userSalt, { gasLimit, maxFeePerGas, maxPriorityFeePerGas });
  console.log(JSON.stringify({ label: "deploy SovereignAgentHarness", hash: tx.hash }, null, 2));
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error(`Harness deployment failed: ${receipt.hash}`);

  const iface = new ethers.Interface(factoryAbi);
  let harness = predictedHarness;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== SOVEREIGN_FACTORY.toLowerCase()) continue;
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === "HarnessDeployed") harness = parsed.args.harness;
    } catch {
      // Ignore unrelated factory logs.
    }
  }

  const result = {
    chainId: network.chainId.toString(),
    owner,
    factory: SOVEREIGN_FACTORY,
    userSalt,
    childSalt,
    harness,
    deployTx: receipt.hash,
    gasUsed: receipt.gasUsed.toString(),
    explorer: `https://explorer.ritualfoundation.org/address/${harness}`,
  };
  fs.mkdirSync(outputsDir, { recursive: true });
  const outputPath = path.join(outputsDir, "sovereign-harness-deployment.json");
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

  console.log(JSON.stringify({ status: "SOVEREIGN_HARNESS_DEPLOYED", outputPath, ...result }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
