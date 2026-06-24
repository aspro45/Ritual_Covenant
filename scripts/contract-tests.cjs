const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ganache = require("ganache");
const solc = require("solc");
const { ethers } = require("ethers");

const kernelSource = fs.readFileSync(path.resolve(process.cwd(), "contracts", "CovenantKernel.sol"), "utf8");
const targetSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ValueTarget {
    uint256 public calls;
    uint256 public received;
    bytes32 public lastTag;

    event Recorded(address indexed sender, uint256 value, bytes32 tag);

    function record(bytes32 tag) external payable returns (bytes32) {
        calls += 1;
        received += msg.value;
        lastTag = tag;
        emit Recorded(msg.sender, msg.value, tag);
        return tag;
    }
}

contract RevertingTarget {
    function fail() external payable {
        revert("TARGET_REVERTED");
    }
}
`;

function compileContracts() {
  const input = {
    language: "Solidity",
    sources: {
      "contracts/CovenantKernel.sol": { content: kernelSource },
      "contracts/TestTargets.sol": { content: targetSource },
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

  const read = (sourceName, contractName) => {
    const artifact = output.contracts[sourceName][contractName];
    return {
      abi: artifact.abi,
      bytecode: `0x${artifact.evm.bytecode.object}`,
    };
  };

  return {
    CovenantKernel: read("contracts/CovenantKernel.sol", "CovenantKernel"),
    ValueTarget: read("contracts/TestTargets.sol", "ValueTarget"),
    RevertingTarget: read("contracts/TestTargets.sol", "RevertingTarget"),
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

function policyHash(label) {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

async function main() {
  const compiled = compileContracts();
  const ganacheProvider = ganache.provider({
    chain: { chainId: 1979 },
    logging: { quiet: true },
    wallet: { deterministic: true, totalAccounts: 10, defaultBalance: 1000 },
  });
  const provider = new ethers.BrowserProvider(ganacheProvider);
  const [owner, attestor, agent, successor, other, beneficiary, agent2, successor2, relayer, agent3] =
    await Promise.all(Array.from({ length: 10 }, (_, index) => provider.getSigner(index)));
  const network = await provider.getNetwork();

  assert.equal(network.chainId, 1979n, "test chain must match Ritual chain id");

  const kernel = await deploy(compiled.CovenantKernel, owner, [await attestor.getAddress()]);
  const target = await deploy(compiled.ValueTarget, owner);
  const revertingTarget = await deploy(compiled.RevertingTarget, owner);
  const targetAddress = await target.getAddress();
  const kernelAddress = await kernel.getAddress();
  const iface = new ethers.Interface(compiled.ValueTarget.abi);
  const failIface = new ethers.Interface(compiled.RevertingTarget.abi);
  const tag = ethers.keccak256(ethers.toUtf8Bytes("allowed-action"));

  assert.equal(await kernel.owner(), await owner.getAddress(), "owner should be deployer");
  assert.equal(await kernel.attestors(await attestor.getAddress()), true, "initial attestor should be trusted");

  const domain = {
    name: "CovenantKernel",
    version: "1",
    chainId: 1979,
    verifyingContract: kernelAddress,
  };
  assert.equal(await kernel.DOMAIN_SEPARATOR(), ethers.TypedDataEncoder.hashDomain(domain), "EIP-712 domain mismatch");

  await expectRevert(
    "direct ETH transfer",
    owner.sendTransaction({ to: kernelAddress, value: ethers.parseEther("0.01") }),
  );

  const agentAddress = await agent.getAddress();
  const successorAddress = await successor.getAddress();
  const firstPolicy = policyHash("policy-one");

  await expectRevert(
    "empty cid registration",
    send(kernel.connect(agent).registerAgent(agentAddress, firstPolicy, "", successorAddress)),
  );
  await expectRevert(
    "self successor registration",
    send(kernel.connect(agent).registerAgent(agentAddress, firstPolicy, "ipfs://policy-one", agentAddress)),
  );

  await send(
    kernel
      .connect(agent)
      .registerAgent(agentAddress, firstPolicy, "ipfs://policy-one", successorAddress, {
        value: ethers.parseEther("1"),
      }),
  );

  let storedAgent = await kernel.agents(1);
  assert.equal(storedAgent.owner, agentAddress, "agent owner mismatch");
  assert.equal(storedAgent.successor, successorAddress, "successor mismatch");
  assert.equal(storedAgent.bond, ethers.parseEther("1"), "bond should be registered");

  await expectRevert("zero fund", send(kernel.connect(agent).fundAgent(1, { value: 0 })));
  await expectRevert("successor heartbeat before inheritance", send(kernel.connect(successor).heartbeat(1)));
  await expectRevert(
    "successor withdraw before inheritance",
    send(kernel.connect(successor).withdrawBond(1, ethers.parseEther("0.01"), successorAddress)),
  );

  const callData = iface.encodeFunctionData("record", [tag]);
  const value = ethers.parseEther("0.2");

  await expectRevert(
    "non-owner submit intent",
    send(kernel.connect(other).submitIntentEnvelope(1, targetAddress, value, callData, 3600)),
  );

  await send(kernel.connect(agent).submitIntentEnvelope(1, targetAddress, value, callData, 3600));
  await expectRevert("non-attestor records decision", send(kernel.connect(other).recordDecision(1, 1, "ipfs://reason")));
  await send(kernel.connect(attestor).recordDecision(1, 1, "ipfs://reason-allowed"));
  await expectRevert("stranger executes approved intent", send(kernel.connect(other).executeApproved(1, callData)));
  await send(kernel.connect(agent).executeApproved(1, callData));

  assert.equal(await target.received(), value, "target should receive approved value");
  assert.equal((await kernel.agents(1)).bond, ethers.parseEther("0.8"), "execution must debit only this agent bond");
  await expectRevert("double execution", send(kernel.connect(agent).executeApproved(1, callData)));

  const agent2Address = await agent2.getAddress();
  const successor2Address = await successor2.getAddress();

  await send(
    kernel
      .connect(agent2)
      .registerAgent(agent2Address, policyHash("policy-two"), "ipfs://policy-two", successor2Address, {
        value: ethers.parseEther("0.05"),
      }),
  );
  await send(kernel.connect(agent2).submitIntentEnvelope(2, targetAddress, ethers.parseEther("0.1"), callData, 3600));
  await send(kernel.connect(attestor).recordDecision(2, 1, "ipfs://reason-too-large"));
  await expectRevert("approved intent cannot drain other agents", send(kernel.connect(agent2).executeApproved(2, callData)));
  assert.equal((await kernel.agents(2)).bond, ethers.parseEther("0.05"), "failed execution should preserve bond");

  await send(kernel.connect(agent2).submitIntent(2, "0x1234", 0));
  await send(kernel.connect(attestor).recordDecision(3, 2, "ipfs://reason-blocked"));
  await expectRevert(
    "blocked decision activates cooldown",
    send(kernel.connect(agent2).submitIntent(2, "0x5678", 0)),
  );

  const agent3Address = await agent3.getAddress();
  const successor3Address = await other.getAddress();

  await send(
    kernel
      .connect(agent3)
      .registerAgent(agent3Address, policyHash("policy-three"), "ipfs://policy-three", successor3Address, {
        value: ethers.parseEther("0.5"),
      }),
  );
  await send(kernel.connect(agent3).submitIntent(3, "0xabcd", 0));
  await send(kernel.connect(attestor).recordDecision(4, 3, "ipfs://reason-slashed"));
  assert.equal((await kernel.agents(3)).status, 2n, "slashed decision should freeze agent");
  await expectRevert("frozen agent cannot submit", send(kernel.connect(agent3).submitIntent(3, "0xabcd", 0)));
  await send(kernel.connect(attestor).slash(3, ethers.parseEther("0.1"), await beneficiary.getAddress()));
  assert.equal((await kernel.agents(3)).bond, ethers.parseEther("0.4"), "slash should debit bond");

  const signedPolicyCid = "ipfs://signed-policy";
  const signedMemoryCid = "ipfs://signed-memory";
  const signedPolicyHash = policyHash("signed-policy");
  const agent4Address = await relayer.getAddress();
  const successor4Address = await beneficiary.getAddress();
  const deadline = BigInt((await provider.getBlock("latest")).timestamp + 3600);
  const signedTypes = {
    Policy: [
      { name: "agent", type: "address" },
      { name: "policyHash", type: "bytes32" },
      { name: "policyCidHash", type: "bytes32" },
      { name: "memoryCidHash", type: "bytes32" },
      { name: "successor", type: "address" },
      { name: "heartbeatAfter", type: "uint64" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };
  const signedValue = {
    agent: agent4Address,
    policyHash: signedPolicyHash,
    policyCidHash: ethers.keccak256(ethers.toUtf8Bytes(signedPolicyCid)),
    memoryCidHash: ethers.keccak256(ethers.toUtf8Bytes(signedMemoryCid)),
    successor: successor4Address,
    heartbeatAfter: 2,
    nonce: await kernel.nonces(agent4Address),
    deadline,
  };
  const relayerAccount = ganacheProvider.getInitialAccounts()[agent4Address.toLowerCase()];
  const relayerWallet = new ethers.Wallet(relayerAccount.secretKey);
  const signature = await relayerWallet.signTypedData(domain, signedTypes, signedValue);

  await send(
    kernel
      .connect(other)
      .registerAgentSigned(
        agent4Address,
        signedPolicyHash,
        signedPolicyCid,
        signedMemoryCid,
        successor4Address,
        2,
        deadline,
        signature,
        { value: ethers.parseEther("0.3") },
      ),
  );

  assert.equal((await kernel.agents(4)).owner, agent4Address, "signed registration owner mismatch");

  await ganacheProvider.request({ method: "evm_increaseTime", params: [3] });
  await ganacheProvider.request({ method: "evm_mine", params: [] });

  await send(kernel.connect(beneficiary).executeWill(4, "ipfs://signed-memory-recovered"));
  const recovered = await kernel.agents(4);
  assert.equal(recovered.owner, successor4Address, "will should transfer owner to successor");
  assert.equal(recovered.status, 1n, "recovered agent should stay active");
  await expectRevert("old owner cannot heartbeat recovered agent", send(kernel.connect(relayer).heartbeat(4)));
  await send(kernel.connect(beneficiary).submitIntent(4, "0xbeef", 0));

  const revertCallData = failIface.encodeFunctionData("fail", []);
  await send(kernel.connect(beneficiary).submitIntentEnvelope(4, await revertingTarget.getAddress(), 0, revertCallData, 3600));
  await send(kernel.connect(attestor).recordDecision(7, 1, "ipfs://will-fail"));
  await expectRevert("approved target revert bubbles as failed execution", send(kernel.connect(beneficiary).executeApproved(7, revertCallData)));

  await ganacheProvider.request({ method: "evm_mine", params: [1782262000000] });

  const millisecondCallData = iface.encodeFunctionData("record", [policyHash("ritual-ms-clock")]);
  await send(
    kernel.registerAgent(await owner.getAddress(), policyHash("policy-ms-clock"), "ipfs://policy-ms-clock", await other.getAddress(), {
      value: ethers.parseEther("0.2"),
    }),
  );
  await send(kernel.submitIntentEnvelope(5, targetAddress, ethers.parseEther("0.01"), millisecondCallData, 3600));
  await send(kernel.connect(attestor).recordDecision(8, 1, "ipfs://reason-ms-clock"));
  await send(kernel.executeApproved(8, millisecondCallData));
  assert.equal((await kernel.intents(8)).executed, true, "millisecond-style chain clock should not expire fresh intents");

  const summary = {
    status: "PASS",
    compiler: solc.version(),
    chainId: network.chainId.toString(),
    kernel: kernelAddress,
    tests: [
      "compile",
      "deploy",
      "domain separator",
      "direct payment rejection",
      "registration validation",
      "owner-only heartbeat and withdraw",
      "owner-only intent submission",
      "attestor-only decisions",
      "approved execution debits agent bond",
      "cross-agent balance drain blocked",
      "blocked cooldown",
      "slashed freeze and debit",
      "EIP-712 signed registration",
      "heartbeat inheritance recovery",
      "target revert preserves state",
      "Ritual millisecond timestamp normalization",
    ],
    warnings: compiled.warnings,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
