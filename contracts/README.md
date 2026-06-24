# CovenantKernel Handoff

`CovenantKernel.sol` is the live policy kernel for the Ritual Covenant project. `CovenantGuardianAgent.sol` is the new companion agent contract: it can own a kernel agent, keep the heartbeat alive, submit guarded intents, preview deterministic decisions, and write kernel receipts when trusted as an attestor.

`CommitRevealBountyJudge.sol` is the privacy-preserving bounty module added for the AI Bounty Judge assignment. It keeps Ritual Covenant's policy theme, but applies it to fair submissions: answers are hidden during commit, verified during reveal, batch-judged once, and finalized from the eligible revealed set.

## Why It Stands Out

- One kernel, four internal lanes: agent registry, bonded value, intent firewall, heartbeat inheritance.
- EIP-712 style policy approval through `policyDigest` and `registerAgentSigned`.
- Deterministic intent hashes and deterministic decision receipt hashes.
- Execution cannot happen through `executeApproved` unless the exact calldata was submitted and an attestor recorded `Allowed`.
- Approved execution debits only the registered agent bond, so one agent cannot drain value bonded by another agent.
- Only the current agent owner can submit executable intents, heartbeat, or withdraw bond. A successor gains control only after `executeWill`.
- `Blocked` decisions apply a cooldown; `Slashed` decisions freeze the agent; `Inherited` decisions are reserved for heartbeat recovery.
- `executeWill` creates a stored inheritance receipt and emits both `DecisionRecorded` and `WillExecuted`.
- Direct ETH transfers revert so value enters through `registerAgent` or `fundAgent` and stays accounted to an agent bond.
- No OpenZeppelin imports and no external dependencies, so it can be pasted directly into Remix.
- Commit-reveal bounty judging is included as a standalone module with the required assignment functions.

## Guardian Agent Layer

`CovenantGuardianAgent` is not a duplicate kernel. It is the agent-facing runtime that sits on top of the live kernel:

1. `registerWithKernel` registers the Guardian contract itself as a `CovenantKernel` agent owner.
2. `pulseKernelHeartbeat` lets any keeper/scheduler pay gas to keep the agent live without receiving authority.
3. `submitGuardianIntent` submits executable intents from the Guardian-owned kernel agent.
4. `previewDecision` reads kernel storage and scores the intent before final receipt gas is spent.
5. `watchKernelIntent` records `Allowed`, `Blocked`, or `Slashed` inside `CovenantKernel` if the Guardian is trusted as an attestor.
6. `executeGuardianApproved` executes only after the kernel stores an `Allowed` receipt.

The Guardian uses configured value limits, target allowlists, calldata revocations, heartbeat checks, and kernel agent status. This keeps policy decisions deterministic and reviewable.

## Commit-Reveal Bounty Judge Layer

`CommitRevealBountyJudge` adds the required workshop flow without changing the deployed Covenant kernel:

1. `submitCommitment(uint256 bountyId, bytes32 commitment)` stores only the answer commitment during the submission phase.
2. `revealAnswer(uint256 bountyId, string calldata answer, bytes32 salt)` verifies `keccak256(abi.encode(answer, salt, msg.sender, bountyId))`.
3. `judgeAll(uint256 bountyId, bytes calldata llmInput)` anchors one canonical batch LLM input hash for all eligible revealed answers.
4. `finalizeWinner(uint256 bountyId, uint256 winnerIndex)` finalizes a winner from the revealed eligible set.

Extra helper surface:

```solidity
createBounty(string promptCid, bytes32 promptHash, uint64 commitDeadline, uint64 revealDeadline)
setJudge(address judge, bool trusted)
computeCommitment(string answer, bytes32 salt, address participant, uint256 bountyId)
getRevealedSubmissionIds(uint256 bountyId)
getRevealedSubmissionCount(uint256 bountyId)
```

Security cases covered locally:

- empty or duplicate commitment
- reveal before commit deadline
- commit after deadline
- reveal without commitment
- copied answer with wrong sender binding
- wrong salt
- duplicate reveal
- judge before reveal deadline
- untrusted judge
- invalid winner index
- double finalize

Advanced Ritual-native note: the commit-reveal version reveals plaintext on-chain after the commit phase. A Ritual TEE version can keep encrypted answers off-chain by CID, decrypt all eligible answers inside a TEE-backed batch judge, and store only hashes, receipts, and final result on-chain.

## Main Flow

1. `registerAgent` or `registerAgentSigned` anchors the agent, policy hash, policy CID, memory CID, successor, and heartbeat rule.
2. `submitIntent` stores a hash-only intent for a no-target review path.
3. `submitIntentEnvelope` stores a full executable intent with target, value, calldata hash, and TTL.
4. `recordDecision` writes the policy result as a machine-readable receipt.
5. `executeApproved` runs only if the stored receipt is `Allowed` and the calldata matches.
6. `slash` moves bonded value after a violation.
7. `executeWill` transfers ownership to the successor after the heartbeat expires.

## Local Verification

Before spending faucet fees, run:

```bash
npm.cmd run contract:compile
npm.cmd run contract:test
npm.cmd run contract:guardian:test
npm.cmd run contract:bounty:test
npm.cmd run contract:gas
```

Current local coverage checks:

- deployment on chain id `1979`
- EIP-712 domain separator
- direct payment rejection
- registration validation
- owner-only heartbeat, withdrawal, and intent submission
- attestor-only decisions
- approved execution debiting the correct agent bond
- cross-agent balance-drain prevention
- blocked cooldown
- slashed freeze and bond debit
- EIP-712 signed registration
- heartbeat inheritance recovery
- target revert behavior
- Ritual-style millisecond timestamp normalization
- Guardian self-registration as a kernel agent
- keeper heartbeat hook and spam guard
- Guardian allowlist/value-limit preview decisions
- Guardian-written kernel decision receipts
- Guardian-approved execution from its own kernel bond
- commit-reveal bounty creation
- hidden commitment submission
- reveal verification against answer, salt, sender, and bounty ID
- single batch LLM input hash
- winner finalization from eligible reveals only

## Deploy Later

Use Remix or a standard Solidity 0.8.24+ toolchain. Ritual Chain deployment values from the official docs:

- Chain ID: `1979`
- RPC: `https://rpc.ritualfoundation.org`
- Explorer: `https://explorer.ritualfoundation.org`
- Faucet: `https://faucet.ritualfoundation.org`

Current deployed testnet kernel:

- Address: `0x4086710799f9d1Cb1eDb4D0a64522F00A5790270`
- Deployment tx: `0xdd17daee2f10ec9489898b5ff3660cdfd11942223c2a167d99f404b09322cd30`
- Deployer / initial attestor: `0xf6d02F13D7BB5fC24aB6A3D662619641958A3Cf6`
- Live smoke tx: `0xc2cfd5ee8d7e0106dd9a3067423731979e8f9c4b907b5f1e5a0762f1877e05fa`
- Live smoke result: agent `1`, check `1`, sink received `0.005`, remaining agent bond `0.045`

Current deployed Guardian companion:

- Address: `0xC5804673c09e0b492bc2371892c8c0270ef0878E`
- Deployment tx: `0x89d11d69c2171f87c2a2051fbc0785cc7e71ce1a6857988d8ba558cdcabc75b5`
- Deployment gas used: `2,729,527`
- Purpose CID: `ipfs://ritual-covenant/guardian-purpose`
- Max intent value: `0.01`
- Target allowlist required: `true`

Current live Guardian flow:

- Kernel agent: `2`
- Guardian check: `2`
- Policy CID: `ipfs://ritual-covenant/guardian-live-policy`
- Mission CID: `ipfs://ritual-covenant/guardian-live-mission`
- Execution value: `0.001`
- Remaining Guardian bond: `0.019`
- Receipt hash: `0xabfe4b8a1981327b2be50cebda7cd47cd7bccfaf07b27b1c966a03d9ffa01935`
- Latest execution tx: `0x602de1ae86a26601388bd3c19a2ad222e420c1fa7fbd3affe52de31aa59019b9`

Live Guardian transactions:

1. Trust Guardian as kernel attestor: `0x3a17d45aed255bf34955fab46bf353360d766aabb091c888ffb8bc4c9465be74`
2. Allow live sink target: `0x1737bf28d20f8b7dda0ff609ad9af698fa6d5f9b8997bfbdbf03af2a43fc4e1c`
3. Register Guardian with kernel: `0x8a481317713cfd6b748937ad417dc2f7017f61854d580ee69b44d98a7b4ce6b5`
4. Submit Guardian intent: `0x3e6a8db969d5f26693be76c2f84ba2daeee390fe66f4e128ad5fb8bd97996d68`
5. Record Guardian decision: `0xfe628ccb56e7acb78ea7af0fcabf141aa0a46ab73e2cd41c015e498f54b45d2f`
6. Execute Guardian approved intent: `0x602de1ae86a26601388bd3c19a2ad222e420c1fa7fbd3affe52de31aa59019b9`

Current deployed commit-reveal bounty judge:

- Address: `0xf25720F49d877F4CAD539C6Bf0d2851B5e3Cb809`
- Deployment tx: `0x6ee694e8fdeecd64759034a130caec0b321381a4df73ebbd782fad4ab843b95f`
- Deployment gas used: `1,489,250`
- Owner / initial judge: `0xf6d02F13D7BB5fC24aB6A3D662619641958A3Cf6`
- Code size: `6,309` bytes

1. Open `contracts/CovenantKernel.sol`.
2. Compile with Solidity `0.8.24` or newer compatible `0.8.x`.
3. Deploy constructor with `initialAttestor`.
4. Copy the deployed address into `src/lib/contracts.ts`.
5. Feed frontend rows from the contract events.

## Frontend ABI Surface

These five calls match the visible contract panel:

```solidity
registerAgent(address agent, bytes32 policyHash, string cid, address successor)
submitIntent(uint256 agentId, bytes intent, uint256 value)
recordDecision(uint256 checkId, uint8 decision, string reasonCid)
slash(uint256 agentId, uint256 amount, address beneficiary)
executeWill(uint256 agentId, string newMemoryCid)
```

Advanced calls available for the full build:

```solidity
registerAgentSigned(...)
submitIntentEnvelope(...)
executeApproved(...)
fundAgent(...)
heartbeat(...)
withdrawBond(...)
policyDigest(...)
computeIntentHash(...)
computeReceiptHash(...)
```

Guardian companion calls:

```solidity
registerWithKernel(bytes32 policyHash, string policyCid, address successor)
pulseKernelHeartbeat()
submitGuardianIntent(address target, uint256 value, bytes callData, uint64 ttl, string missionCid)
previewDecision(uint256 checkId)
watchKernelIntent(uint256 checkId)
executeGuardianApproved(uint256 checkId, bytes callData)
```

Bounty judge calls:

```solidity
submitCommitment(uint256 bountyId, bytes32 commitment)
revealAnswer(uint256 bountyId, string answer, bytes32 salt)
judgeAll(uint256 bountyId, bytes llmInput)
finalizeWinner(uint256 bountyId, uint256 winnerIndex)
```

## Guardian Deploy Safety

Use the preflight mode before spending faucet fees:

```bash
set DRY_RUN=true&& npm.cmd run contract:deploy:guardian
```

Local gas simulation:

- Deploy `CovenantGuardianAgent`: `2,684,461` gas
- Full Guardian flow: `3,667,618` gas

Do not run the real Guardian deploy until the dry run confirms the Ritual RPC chain id, deployed kernel code, deployer balance, gas price, and reserve.

## Receipt Samples

Use these files when explaining the product before deployment:

- `examples/breach-receipt.json`
- `examples/inheritance-receipt.json`
