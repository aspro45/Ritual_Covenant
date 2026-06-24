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

function optionalAddress(name, fallback) {
  const value = process.env[name]?.trim();
  return value || fallback;
}

function compileKernel() {
  const source = fs.readFileSync(path.resolve(process.cwd(), "contracts", "CovenantKernel.sol"), "utf8");
  const input = {
    language: "Solidity",
    sources: {
      "contracts/CovenantKernel.sol": { content: source },
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

  const artifact = output.contracts["contracts/CovenantKernel.sol"].CovenantKernel;
  return {
    abi: artifact.abi,
    bytecode: `0x${artifact.evm.bytecode.object}`,
    warnings: errors.filter((item) => item.severity !== "error").map((item) => item.formattedMessage),
  };
}

function validatePrivateKey(privateKey) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("DEPLOYER_PRIVATE_KEY must start with 0x and contain exactly 64 hex chars after it.");
  }
}

function normalizePolicyHash(value) {
  const trimmed = value?.trim();
  if (trimmed && /^0x[0-9a-fA-F]{64}$/.test(trimmed)) return trimmed;
  const seed = trimmed || `${process.env.POLICY_CID || "policy"}|${process.env.MEMORY_CID || "memory"}`;
  return ethers.keccak256(ethers.toUtf8Bytes(seed));
}

async function main() {
  loadEnv();

  const rpcUrl = requireEnv("RITUAL_RPC_URL");
  const expectedChainId = BigInt(requireEnv("RITUAL_CHAIN_ID"));
  const privateKey = requireEnv("DEPLOYER_PRIVATE_KEY");
  validatePrivateKey(privateKey);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const deployer = await wallet.getAddress();
  const initialAttestor = optionalAddress("INITIAL_ATTESTOR", deployer);
  const network = await provider.getNetwork();

  if (network.chainId !== expectedChainId) {
    throw new Error(`Wrong chain. Expected ${expectedChainId}, RPC returned ${network.chainId}.`);
  }

  if (!ethers.isAddress(initialAttestor)) {
    throw new Error("INITIAL_ATTESTOR must be empty or a valid address.");
  }

  const balance = await provider.getBalance(deployer);
  const gasPrice = await provider.getFeeData();
  const artifact = compileKernel();
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const deployTx = await factory.getDeployTransaction(initialAttestor);
  const deployGas = await provider.estimateGas({ ...deployTx, from: deployer });
  const gasUnitPrice = gasPrice.gasPrice || gasPrice.maxFeePerGas || 1_000_000_000n;
  const deployGasCost = deployGas * gasUnitPrice;

  console.log(
    JSON.stringify(
      {
        step: "preflight",
        chainId: network.chainId.toString(),
        deployer,
        initialAttestor,
        balance: ethers.formatEther(balance),
        gasUnitPriceGwei: ethers.formatUnits(gasUnitPrice, "gwei"),
        estimatedDeployGas: deployGas.toString(),
        estimatedDeployCost: ethers.formatEther(deployGasCost),
        warnings: artifact.warnings,
      },
      null,
      2,
    ),
  );

  const smokeBond = ethers.parseEther(process.env.AGENT_BOND?.trim() || "0");
  const reserve = ethers.parseEther("0.01");

  if (balance < deployGasCost + smokeBond + reserve) {
    throw new Error(
      `Balance too low. Need at least deploy cost + smoke bond + 0.01 reserve; have ${ethers.formatEther(balance)}.`,
    );
  }

  const contract = await factory.deploy(initialAttestor);
  const deploymentReceipt = await contract.deploymentTransaction().wait();
  const contractAddress = await contract.getAddress();
  const result = {
    chainId: network.chainId.toString(),
    deployer,
    initialAttestor,
    contractAddress,
    deploymentTx: deploymentReceipt.hash,
    deploymentGasUsed: deploymentReceipt.gasUsed.toString(),
    explorer: `https://explorer.ritualfoundation.org/address/${contractAddress}`,
    smokeTest: null,
  };

  if ((process.env.RUN_DEPLOY_SMOKE_TEST || "").toLowerCase() === "true") {
    const agent = optionalAddress("AGENT_ADDRESS", deployer);
    const successor = requireEnv("SUCCESSOR_ADDRESS");
    const policyCid = requireEnv("POLICY_CID");
    const memoryCid = process.env.MEMORY_CID?.trim() || policyCid;
    const policyHash = normalizePolicyHash(process.env.POLICY_HASH);

    if (!ethers.isAddress(agent)) throw new Error("AGENT_ADDRESS must be empty or a valid address.");
    if (!ethers.isAddress(successor)) throw new Error("SUCCESSOR_ADDRESS must be a valid address for smoke test.");

    const tx = await contract.registerAgent(agent, policyHash, policyCid, successor, { value: smokeBond });
    const receipt = await tx.wait();

    result.smokeTest = {
      registerAgentTx: receipt.hash,
      registerAgentGasUsed: receipt.gasUsed.toString(),
      agent,
      successor,
      policyHash,
      policyCid,
      memoryCid,
      bond: ethers.formatEther(smokeBond),
    };
  }

  fs.mkdirSync(outputsDir, { recursive: true });
  const outputPath = path.join(outputsDir, "ritual-deployment.json");
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

  console.log(JSON.stringify({ status: "DEPLOYED", outputPath, ...result }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
