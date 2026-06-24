const fs = require("fs");
const path = require("path");
const ganache = require("ganache");
const solc = require("solc");
const { ethers } = require("ethers");

const kernelSource = fs.readFileSync(path.resolve(process.cwd(), "contracts", "CovenantKernel.sol"), "utf8");
const sinkSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract ValueSink {
    uint256 public received;
    function receiveValue(bytes32) external payable {
        received += msg.value;
    }
}
`;

function compile() {
  const input = {
    language: "Solidity",
    sources: {
      "contracts/CovenantKernel.sol": { content: kernelSource },
      "contracts/ValueSink.sol": { content: sinkSource },
    },
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

  const artifact = (source, name) => {
    const item = output.contracts[source][name];
    return { abi: item.abi, bytecode: `0x${item.evm.bytecode.object}` };
  };

  return {
    CovenantKernel: artifact("contracts/CovenantKernel.sol", "CovenantKernel"),
    ValueSink: artifact("contracts/ValueSink.sol", "ValueSink"),
  };
}

async function deploy(artifact, signer, args = []) {
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await factory.deploy(...args);
  const receipt = await contract.deploymentTransaction().wait();
  return { contract, gasUsed: receipt.gasUsed };
}

async function txGas(label, txPromise, rows) {
  const receipt = await (await txPromise).wait();
  rows.push({ label, gas: receipt.gasUsed });
}

function nativeCost(gas, gwei) {
  return ethers.formatEther(gas * BigInt(gwei) * 1_000_000_000n);
}

async function main() {
  const compiled = compile();
  const provider = ganache.provider({
    chain: { chainId: 1979 },
    logging: { quiet: true },
    wallet: { deterministic: true, totalAccounts: 6, defaultBalance: 1000 },
  });
  const ethersProvider = new ethers.BrowserProvider(provider);
  const [owner, attestor, agent, successor, beneficiary] = await Promise.all(
    Array.from({ length: 5 }, (_, index) => ethersProvider.getSigner(index)),
  );
  const rows = [];

  const kernelDeploy = await deploy(compiled.CovenantKernel, owner, [await attestor.getAddress()]);
  const sinkDeploy = await deploy(compiled.ValueSink, owner);
  const kernel = kernelDeploy.contract;
  const sink = sinkDeploy.contract;
  const sinkIface = new ethers.Interface(compiled.ValueSink.abi);
  const policyHash = ethers.keccak256(ethers.toUtf8Bytes("gas-policy"));
  const calldata = sinkIface.encodeFunctionData("receiveValue", [ethers.keccak256(ethers.toUtf8Bytes("intent"))]);

  rows.push({ label: "deploy CovenantKernel", gas: kernelDeploy.gasUsed });
  rows.push({ label: "deploy ValueSink test target", gas: sinkDeploy.gasUsed });

  await txGas(
    "registerAgent with 1 token bond",
    kernel
      .connect(agent)
      .registerAgent(await agent.getAddress(), policyHash, "ipfs://policy", await successor.getAddress(), {
        value: ethers.parseEther("1"),
      }),
    rows,
  );
  await txGas(
    "submitIntentEnvelope",
    kernel.connect(agent).submitIntentEnvelope(1, await sink.getAddress(), ethers.parseEther("0.01"), calldata, 3600),
    rows,
  );
  await txGas("recordDecision Allowed", kernel.connect(attestor).recordDecision(1, 1, "ipfs://allowed"), rows);
  await txGas("executeApproved", kernel.connect(agent).executeApproved(1, calldata), rows);
  await txGas("submitIntent hash-only", kernel.connect(agent).submitIntent(1, "0x1234", 0), rows);
  await txGas("recordDecision Blocked", kernel.connect(attestor).recordDecision(2, 2, "ipfs://blocked"), rows);

  await provider.request({ method: "evm_increaseTime", params: [4 * 60 * 60 + 1] });
  await provider.request({ method: "evm_mine", params: [] });
  await txGas("executeWill after heartbeat expiry", kernel.connect(successor).executeWill(1, "ipfs://new-memory"), rows);

  await txGas(
    "slash 0.01 token",
    kernel.connect(attestor).slash(1, ethers.parseEther("0.01"), await beneficiary.getAddress()),
    rows,
  );

  const appFlowGas = rows
    .filter((row) => row.label !== "deploy ValueSink test target")
    .reduce((sum, row) => sum + row.gas, 0n);
  const coreDeployAndSmokeGas = rows
    .filter((row) =>
      [
        "deploy CovenantKernel",
        "registerAgent with 1 token bond",
        "submitIntentEnvelope",
        "recordDecision Allowed",
        "executeApproved",
      ].includes(row.label),
    )
    .reduce((sum, row) => sum + row.gas, 0n);

  const scenarios = [1, 5, 20, 100].map((gwei) => ({
    gwei,
    deployOnlyNative: nativeCost(kernelDeploy.gasUsed, gwei),
    deployAndSmokeNative: nativeCost(coreDeployAndSmokeGas, gwei),
    fullLocalFlowNative: nativeCost(appFlowGas, gwei),
  }));

  console.log(
    JSON.stringify(
      {
        status: "PASS",
        chainId: "1979",
        rows: rows.map((row) => ({ label: row.label, gas: row.gas.toString() })),
        totals: {
          coreDeployAndSmokeGas: coreDeployAndSmokeGas.toString(),
          fullLocalFlowGas: appFlowGas.toString(),
        },
        scenarios,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
