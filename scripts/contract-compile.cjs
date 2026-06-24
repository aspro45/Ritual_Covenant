const fs = require("fs");
const path = require("path");
const solc = require("solc");

const outputsDir = path.resolve(process.cwd(), "..", "..", "outputs");

const sources = {
  "contracts/CovenantKernel.sol": {
    content: fs.readFileSync(path.resolve(process.cwd(), "contracts", "CovenantKernel.sol"), "utf8"),
  },
  "contracts/CovenantGuardianAgent.sol": {
    content: fs.readFileSync(path.resolve(process.cwd(), "contracts", "CovenantGuardianAgent.sol"), "utf8"),
  },
  "contracts/CommitRevealBountyJudge.sol": {
    content: fs.readFileSync(path.resolve(process.cwd(), "contracts", "CommitRevealBountyJudge.sol"), "utf8"),
  },
};

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: {
      enabled: true,
      runs: 200,
    },
    evmVersion: "shanghai",
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "metadata"],
      },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = output.errors || [];
const fatal = errors.filter((item) => item.severity === "error");

if (fatal.length > 0) {
  console.error(errors.map((item) => item.formattedMessage).join("\n"));
  process.exit(1);
}

fs.mkdirSync(outputsDir, { recursive: true });

const contracts = [
  { source: "contracts/CovenantKernel.sol", name: "CovenantKernel" },
  { source: "contracts/CovenantGuardianAgent.sol", name: "CovenantGuardianAgent" },
  { source: "contracts/CommitRevealBountyJudge.sol", name: "CommitRevealBountyJudge" },
];

const artifacts = contracts.map(({ source, name }) => {
  const artifact = output.contracts[source][name];
  const bytecode = artifact.evm.bytecode.object;
  const deployedBytecode = artifact.evm.deployedBytecode.object;
  const abiPath = path.join(outputsDir, `${name}.abi.json`);

  fs.writeFileSync(abiPath, JSON.stringify(artifact.abi, null, 2));

  return {
    name,
    source,
    abiPath,
    bytecodeBytes: bytecode.length / 2,
    deployedBytecodeBytes: deployedBytecode.length / 2,
  };
});

const summaryPath = path.join(outputsDir, "CovenantKernel.compile-summary.json");

const summary = {
  compiler: solc.version(),
  optimizer: input.settings.optimizer,
  evmVersion: input.settings.evmVersion,
  artifacts,
  warnings: errors.filter((item) => item.severity !== "error").map((item) => item.formattedMessage),
};

fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
