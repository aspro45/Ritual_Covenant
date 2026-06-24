const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ganache = require("ganache");
const solc = require("solc");
const { ethers } = require("ethers");

const bountySource = fs.readFileSync(path.resolve(process.cwd(), "contracts", "CommitRevealBountyJudge.sol"), "utf8");

function compileContracts() {
  const input = {
    language: "Solidity",
    sources: {
      "contracts/CommitRevealBountyJudge.sol": { content: bountySource },
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

  const artifact = output.contracts["contracts/CommitRevealBountyJudge.sol"].CommitRevealBountyJudge;
  return {
    CommitRevealBountyJudge: {
      abi: artifact.abi,
      bytecode: `0x${artifact.evm.bytecode.object}`,
    },
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

async function now(provider) {
  return BigInt((await provider.getBlock("latest")).timestamp);
}

async function advance(ganacheProvider, seconds) {
  await ganacheProvider.request({ method: "evm_increaseTime", params: [seconds] });
  await ganacheProvider.request({ method: "evm_mine", params: [] });
}

async function main() {
  const compiled = compileContracts();
  const ganacheProvider = ganache.provider({
    chain: { chainId: 1979 },
    logging: { quiet: true },
    wallet: { deterministic: true, totalAccounts: 8, defaultBalance: 1000 },
  });
  const provider = new ethers.BrowserProvider(ganacheProvider);
  const [owner, creator, alice, bob, stranger, judgeSigner] = await Promise.all(
    Array.from({ length: 6 }, (_, index) => provider.getSigner(index)),
  );
  const network = await provider.getNetwork();

  assert.equal(network.chainId, 1979n, "test chain must match Ritual chain id");

  const bountyJudge = await deploy(compiled.CommitRevealBountyJudge, owner);
  const bountyAddress = await bountyJudge.getAddress();
  const currentTime = await now(provider);
  const commitDeadline = currentTime + 60n;
  const revealDeadline = currentTime + 130n;
  const promptCid = "ipfs://ritual-covenant/bounty-prompt";
  const promptHash = ethers.keccak256(ethers.toUtf8Bytes("Judge bounty fairly without leaking answers."));

  assert.equal(await bountyJudge.owner(), await owner.getAddress(), "owner mismatch");
  assert.equal(await bountyJudge.judges(await owner.getAddress()), true, "owner should start as judge");

  await send(bountyJudge.connect(owner).setJudge(await judgeSigner.getAddress(), true));
  assert.equal(await bountyJudge.judges(await judgeSigner.getAddress()), true, "judge should be trusted");

  await send(bountyJudge.connect(creator).createBounty(promptCid, promptHash, commitDeadline, revealDeadline));
  assert.equal(await bountyJudge.nextBountyId(), 2n, "first bounty should be created");

  const bounty = await bountyJudge.bounties(1);
  assert.equal(bounty.creator, await creator.getAddress(), "creator mismatch");
  assert.equal(bounty.promptCid, promptCid, "prompt cid mismatch");

  const aliceSalt = ethers.keccak256(ethers.toUtf8Bytes("alice-private-salt"));
  const bobSalt = ethers.keccak256(ethers.toUtf8Bytes("bob-private-salt"));
  const aliceAnswer = "Use commit-reveal so ideas stay hidden until reveal.";
  const bobAnswer = "Batch the revealed answers and judge once with a Ritual-backed agent.";
  const aliceCommitment = await bountyJudge.computeCommitment(aliceAnswer, aliceSalt, await alice.getAddress(), 1);
  const bobCommitment = await bountyJudge.computeCommitment(bobAnswer, bobSalt, await bob.getAddress(), 1);

  await expectRevert("zero commitment", send(bountyJudge.connect(stranger).submitCommitment(1, ethers.ZeroHash)));
  await send(bountyJudge.connect(alice).submitCommitment(1, aliceCommitment));
  await send(bountyJudge.connect(bob).submitCommitment(1, bobCommitment));
  await expectRevert("duplicate commit", send(bountyJudge.connect(alice).submitCommitment(1, aliceCommitment)));
  await expectRevert("early reveal", send(bountyJudge.connect(alice).revealAnswer(1, aliceAnswer, aliceSalt)));

  await advance(ganacheProvider, 70);

  await expectRevert("commit after deadline", send(bountyJudge.connect(stranger).submitCommitment(1, ethers.keccak256(ethers.toUtf8Bytes("late")))));
  await expectRevert("stranger has no commitment", send(bountyJudge.connect(stranger).revealAnswer(1, "copied answer", aliceSalt)));
  await expectRevert("wrong salt rejected", send(bountyJudge.connect(alice).revealAnswer(1, aliceAnswer, bobSalt)));

  const revealTime = await now(provider);
  const revealBounty = await bountyJudge.bounties(1);
  const aliceStored = await bountyJudge.submissions(1, 1);
  assert.ok(revealTime > revealBounty.commitDeadline, "reveal phase should be open");
  assert.ok(revealTime <= revealBounty.revealDeadline, "reveal phase should not be closed");
  assert.equal(
    aliceStored.commitment,
    await bountyJudge.computeCommitment(aliceAnswer, aliceSalt, await alice.getAddress(), 1),
    "stored commitment should match valid reveal",
  );

  await send(bountyJudge.connect(alice).revealAnswer(1, aliceAnswer, aliceSalt, { gasLimit: 800000 }));
  await expectRevert("duplicate reveal", send(bountyJudge.connect(alice).revealAnswer(1, aliceAnswer, aliceSalt)));
  await send(bountyJudge.connect(bob).revealAnswer(1, bobAnswer, bobSalt, { gasLimit: 800000 }));
  assert.equal(await bountyJudge.getRevealedSubmissionCount(1), 2n, "only valid reveals should be eligible");

  const revealedIds = await bountyJudge.getRevealedSubmissionIds(1);
  assert.deepEqual(revealedIds.map((item) => item.toString()), ["1", "2"], "revealed ID order mismatch");

  await expectRevert("judging before reveal closes", send(bountyJudge.connect(judgeSigner).judgeAll(1, ethers.toUtf8Bytes("too early"))));
  await advance(ganacheProvider, 80);

  await expectRevert("untrusted judge", send(bountyJudge.connect(stranger).judgeAll(1, ethers.toUtf8Bytes("batch"))));
  const batchInput = ethers.toUtf8Bytes(
    JSON.stringify({
      bountyId: 1,
      promptCid,
      eligibleSubmissionIds: revealedIds.map((item) => item.toString()),
      answerHashes: [
        ethers.keccak256(ethers.toUtf8Bytes(aliceAnswer)),
        ethers.keccak256(ethers.toUtf8Bytes(bobAnswer)),
      ],
    }),
  );
  await send(bountyJudge.connect(judgeSigner).judgeAll(1, batchInput));
  const judgedBounty = await bountyJudge.bounties(1);
  assert.equal(judgedBounty.judged, true, "bounty should be marked judged");
  assert.equal(judgedBounty.llmInputHash, ethers.keccak256(batchInput), "batch input hash mismatch");

  await expectRevert("bad winner index", send(bountyJudge.connect(creator).finalizeWinner(1, 3)));
  await send(bountyJudge.connect(creator).finalizeWinner(1, 1));
  const finalized = await bountyJudge.bounties(1);
  assert.equal(finalized.finalized, true, "bounty should be finalized");
  assert.equal(finalized.winnerIndex, 1n, "winner index mismatch");
  assert.equal(finalized.winnerSubmissionId, 2n, "winner submission mismatch");
  assert.equal(finalized.winner, await bob.getAddress(), "winner address mismatch");
  await expectRevert("double finalize", send(bountyJudge.connect(creator).finalizeWinner(1, 0)));

  const summary = {
    status: "PASS",
    compiler: solc.version(),
    chainId: network.chainId.toString(),
    contract: bountyAddress,
    tests: [
      "compile commit-reveal bounty judge",
      "deploy standalone EVM contract",
      "create bounty with commit and reveal deadlines",
      "reject empty commitments",
      "reject duplicate commitments",
      "reject early reveals",
      "reject late commitments",
      "reject reveals without prior commitments",
      "reject wrong salt or copied answer",
      "accept valid reveals only after commit deadline",
      "track eligible revealed submissions",
      "reject judging before reveal deadline",
      "restrict judging to creator or trusted judge",
      "anchor one batch LLM input hash",
      "finalize winner from eligible revealed set",
      "reject invalid winner and double finalize",
    ],
    warnings: compiled.warnings,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
