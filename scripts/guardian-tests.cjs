const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ganache = require("ganache");
const solc = require("solc");
const { ethers } = require("ethers");

const kernelSource = fs.readFileSync(path.resolve(process.cwd(), "contracts", "CovenantKernel.sol"), "utf8");
const guardianSource = fs.readFileSync(path.resolve(process.cwd(), "contracts", "CovenantGuardianAgent.sol"), "utf8");
const targetSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract GuardianTarget {
    uint256 public calls;
    uint256 public received;
    bytes32 public lastTag;

    event TargetCalled(address indexed sender, uint256 value, bytes32 tag);

    function receiveDecision(bytes32 tag) external payable returns (bytes32) {
        calls += 1;
        received += msg.value;
        lastTag = tag;
        emit TargetCalled(msg.sender, msg.value, tag);
        return tag;
    }
}
`;

function compileContracts() {
  const input = {
    language: "Solidity",
    sources: {
      "contracts/CovenantKernel.sol": { content: kernelSource },
      "contracts/CovenantGuardianAgent.sol": { content: guardianSource },
      "contracts/GuardianTarget.sol": { content: targetSource },
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

  const artifact = (source, name) => {
    const item = output.contracts[source][name];
    return { abi: item.abi, bytecode: `0x${item.evm.bytecode.object}` };
  };

  return {
    CovenantKernel: artifact("contracts/CovenantKernel.sol", "CovenantKernel"),
    CovenantGuardianAgent: artifact("contracts/CovenantGuardianAgent.sol", "CovenantGuardianAgent"),
    GuardianTarget: artifact("contracts/GuardianTarget.sol", "GuardianTarget"),
    warnings: errors.filter((item) => item.severity !== "error").map((item) => item.formattedMessage),
  };
}

async function deploy(artifact, signer, args = []) {
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function send(txPromise) {
  const tx = await txPromise;
  return tx.wait();
}

async function expectRevert(label, txPromise) {
  try {
    await txPromise;
  } catch {
    return;
  }

  throw new Error(`${label} did not revert`);
}

function hash(label) {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

async function main() {
  const compiled = compileContracts();
  const ganacheProvider = ganache.provider({
    chain: { chainId: 1979 },
    logging: { quiet: true },
    wallet: { deterministic: true, totalAccounts: 8, defaultBalance: 1000 },
  });
  const provider = new ethers.BrowserProvider(ganacheProvider);
  const [owner, operator, successor, keeper, stranger, targetDeployer] = await Promise.all(
    Array.from({ length: 6 }, (_, index) => provider.getSigner(index)),
  );
  const network = await provider.getNetwork();

  assert.equal(network.chainId, 1979n, "test chain must match Ritual chain id");

  const kernel = await deploy(compiled.CovenantKernel, owner, [await owner.getAddress()]);
  const target = await deploy(compiled.GuardianTarget, targetDeployer);
  const targetIface = new ethers.Interface(compiled.GuardianTarget.abi);
  const callData = targetIface.encodeFunctionData("receiveDecision", [hash("guardian-allowed")]);
  const maxIntentValue = ethers.parseEther("0.1");

  const guardianFactory = new ethers.ContractFactory(
    compiled.CovenantGuardianAgent.abi,
    compiled.CovenantGuardianAgent.bytecode,
    operator,
  );
  const guardianDeployTx = await guardianFactory.getDeployTransaction(
    await kernel.getAddress(),
    hash("guardian-purpose"),
    "ipfs://guardian-purpose",
    maxIntentValue,
    true,
  );
  const guardianDeployGas = await provider.estimateGas({ ...guardianDeployTx, from: await operator.getAddress() });
  assert.ok(guardianDeployGas > 0n, "guardian deploy gas should estimate");

  const guardian = await deploy(compiled.CovenantGuardianAgent, operator, [
    await kernel.getAddress(),
    hash("guardian-purpose"),
    "ipfs://guardian-purpose",
    maxIntentValue,
    true,
  ]);
  const guardianAddress = await guardian.getAddress();

  assert.equal(await guardian.operator(), await operator.getAddress(), "operator mismatch");
  assert.equal(await guardian.kernel(), await kernel.getAddress(), "kernel mismatch");
  assert.equal(await guardian.maxIntentValue(), maxIntentValue, "value limit mismatch");
  assert.equal(await guardian.requireTargetAllowlist(), true, "allowlist mode mismatch");

  await expectRevert(
    "non-operator cannot configure target",
    send(guardian.connect(stranger).setTargetAllowed(await target.getAddress(), true)),
  );
  await send(guardian.connect(operator).setTargetAllowed(await target.getAddress(), true));
  assert.equal(await guardian.allowedTargets(await target.getAddress()), true, "target should be allowlisted");

  await send(kernel.connect(owner).setAttestor(guardianAddress, true));
  assert.equal(await kernel.attestors(guardianAddress), true, "guardian should be trusted attestor");

  await expectRevert(
    "non-operator cannot register guardian agent",
    send(guardian.connect(stranger).registerWithKernel(hash("policy"), "ipfs://guardian-policy", await successor.getAddress())),
  );

  await send(
    guardian
      .connect(operator)
      .registerWithKernel(hash("guardian-policy"), "ipfs://guardian-policy", await successor.getAddress(), {
        value: ethers.parseEther("1"),
      }),
  );

  assert.equal(await guardian.kernelAgentId(), 1n, "guardian should link kernel agent #1");
  const storedAgent = await kernel.agents(1);
  assert.equal(storedAgent.owner, guardianAddress, "kernel agent should be owned by guardian contract");
  assert.equal(storedAgent.successor, await successor.getAddress(), "successor mismatch");
  assert.equal(storedAgent.bond, ethers.parseEther("1"), "guardian bond mismatch");

  await expectRevert(
    "guardian cannot be registered twice",
    send(guardian.connect(operator).registerWithKernel(hash("policy-2"), "ipfs://guardian-policy-2", await successor.getAddress())),
  );

  await send(guardian.connect(keeper).pulseKernelHeartbeat());
  await expectRevert("heartbeat spacing protects from spam", send(guardian.connect(keeper).pulseKernelHeartbeat()));

  await expectRevert(
    "non-operator cannot submit guardian intent",
    send(guardian.connect(stranger).submitGuardianIntent(await target.getAddress(), 0, callData, 3600, "ipfs://mission-denied")),
  );

  await send(
    guardian
      .connect(operator)
      .submitGuardianIntent(await target.getAddress(), ethers.parseEther("0.05"), callData, 3600, "ipfs://mission-allowed"),
  );

  const [allowedDecision, allowedReason, allowedReasonCid] = await guardian.previewDecision(1);
  assert.equal(allowedDecision, 1n, "allowed preview decision mismatch");
  assert.equal(allowedReason, 1n, "allowed reason mismatch");
  assert.equal(allowedReasonCid, "ipfs://covenant-guardian/allowed", "allowed reason cid mismatch");

  await send(guardian.connect(keeper).watchKernelIntent(1));
  const receipt = await kernel.receipts(1);
  assert.equal(receipt.decision, 1n, "guardian should record allowed decision");
  assert.equal(receipt.attestor, guardianAddress, "guardian should be receipt attestor");
  assert.equal(receipt.reasonCid, "ipfs://covenant-guardian/allowed", "kernel reason cid mismatch");
  await expectRevert("already decided intent cannot be decided twice", send(guardian.connect(keeper).watchKernelIntent(1)));

  await send(guardian.connect(operator).executeGuardianApproved(1, callData));
  assert.equal(await target.received(), ethers.parseEther("0.05"), "target should receive approved value");
  assert.equal((await kernel.agents(1)).bond, ethers.parseEther("0.95"), "execution should debit guardian bond");

  const blockedCallData = targetIface.encodeFunctionData("receiveDecision", [hash("too-large")]);
  await send(
    guardian
      .connect(operator)
      .submitGuardianIntent(await target.getAddress(), ethers.parseEther("0.2"), blockedCallData, 3600, "ipfs://mission-blocked"),
  );

  const [blockedDecision, blockedReason, blockedReasonCid] = await guardian.previewDecision(2);
  assert.equal(blockedDecision, 2n, "large value should be blocked");
  assert.equal(blockedReason, 2n, "large value reason mismatch");
  assert.equal(blockedReasonCid, "ipfs://covenant-guardian/value-limit", "large value reason cid mismatch");
  await send(guardian.connect(stranger).watchKernelIntent(2));
  const blockedReceipt = await kernel.receipts(2);
  assert.equal(blockedReceipt.decision, 2n, "blocked decision mismatch");
  assert.equal(blockedReceipt.attestor, guardianAddress, "blocked receipt attestor mismatch");

  const summary = {
    status: "PASS",
    compiler: solc.version(),
    chainId: network.chainId.toString(),
    kernel: await kernel.getAddress(),
    guardian: guardianAddress,
    guardianDeployGas: guardianDeployGas.toString(),
    tests: [
      "compile guardian with kernel",
      "deploy guardian",
      "operator-only configuration",
      "kernel attestor wiring",
      "guardian self-registration as kernel agent",
      "keeper heartbeat hook with spam guard",
      "operator-only intent submission",
      "allowlist + value-limit preview decisions",
      "guardian writes kernel decision receipts",
      "guardian executes approved kernel intent",
      "oversized intent blocked deterministically",
    ],
    warnings: compiled.warnings,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
