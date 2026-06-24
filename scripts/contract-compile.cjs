const fs = require("fs");
const path = require("path");
const solc = require("solc");

const contractPath = path.resolve(process.cwd(), "contracts", "CovenantKernel.sol");
const outputsDir = path.resolve(process.cwd(), "..", "..", "outputs");
const source = fs.readFileSync(contractPath, "utf8");

const input = {
  language: "Solidity",
  sources: {
    "contracts/CovenantKernel.sol": {
      content: source,
    },
  },
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

const artifact = output.contracts["contracts/CovenantKernel.sol"].CovenantKernel;
const bytecode = artifact.evm.bytecode.object;
const deployedBytecode = artifact.evm.deployedBytecode.object;
const abiPath = path.join(outputsDir, "CovenantKernel.abi.json");
const summaryPath = path.join(outputsDir, "CovenantKernel.compile-summary.json");

fs.writeFileSync(abiPath, JSON.stringify(artifact.abi, null, 2));

const summary = {
  compiler: solc.version(),
  optimizer: input.settings.optimizer,
  evmVersion: input.settings.evmVersion,
  abiPath,
  bytecodeBytes: bytecode.length / 2,
  deployedBytecodeBytes: deployedBytecode.length / 2,
  warnings: errors.filter((item) => item.severity !== "error").map((item) => item.formattedMessage),
};

fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
