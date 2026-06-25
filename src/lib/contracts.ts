export const RITUAL_TESTNET = {
  chainName: "Ritual Chain Testnet",
  chainId: 1979,
  rpcUrl: "https://rpc.ritualfoundation.org",
  explorerUrl: "https://explorer.ritualfoundation.org",
  faucetUrl: "https://faucet.ritualfoundation.org",
  status: "live verified",
  covenantKernel: "0x4086710799f9d1Cb1eDb4D0a64522F00A5790270",
  covenantGuardian: "0xC5804673c09e0b492bc2371892c8c0270ef0878E",
  commitRevealBountyJudge: "0xf25720F49d877F4CAD539C6Bf0d2851B5e3Cb809",
  covenantSentinel: "0xa7Badcc7Cd6DD85936B2F72631aD1F804815f62c",
  sovereignHarness: "0xc90dFb7367CBD90c2874D819123571f566347E5D",
};

export const LIVE_PROOF = {
  agentId: 1,
  checkId: 1,
  sinkAddress: "0x9da44dc63BDdb225Fd819D18c06fa91C5f94Ff91",
  deploymentTx: "0xdd17daee2f10ec9489898b5ff3660cdfd11942223c2a167d99f404b09322cd30",
  txs: [
    {
      label: "Deploy RitualValueSink",
      hash: "0x94f6cb7c8f65873e6aab18c5ca52a8eb8aee301e056e8554429be2103496c2a3",
      blockNumber: "36761478",
      gasUsed: "126151",
    },
    {
      label: "Register live agent",
      hash: "0xd5a51406cb2f124310e947b19c2fbe6328449a924501635906a669837f11d49f",
      blockNumber: "36761510",
      gasUsed: "326729",
    },
    {
      label: "Submit executable intent",
      hash: "0x29e3cd7acece9991983b16968f6d1887e2dee23804c8a498c0e18d209aa31393",
      blockNumber: "36761541",
      gasUsed: "198001",
    },
    {
      label: "Record allowed decision",
      hash: "0x693019b237d24b91c9ead57c3b8346164a7818734b53118828c52f8e02c12c0d",
      blockNumber: "36761571",
      gasUsed: "281897",
    },
    {
      label: "Execute approved intent",
      hash: "0xc2cfd5ee8d7e0106dd9a3067423731979e8f9c4b907b5f1e5a0762f1877e05fa",
      blockNumber: "36761600",
      gasUsed: "110738",
    },
  ],
};

export const contractIntegrationChecklist = [
  "Run npm.cmd run contract:compile and npm.cmd run contract:test before spending faucet fees.",
  "CovenantKernel is live on Ritual Chain Testnet at 0x4086710799f9d1Cb1eDb4D0a64522F00A5790270.",
  "CovenantGuardianAgent is live at 0xC5804673c09e0b492bc2371892c8c0270ef0878E after local tests, gas estimates, and dry-run preflight.",
  "CommitRevealBountyJudge is deployed live at 0xf25720F49d877F4CAD539C6Bf0d2851B5e3Cb809 after local commit/reveal/judging tests.",
  "CovenantSentinelAgent is live at 0xa7Badcc7Cd6DD85936B2F72631aD1F804815f62c as a direct Sovereign Agent precompile consumer.",
  "A listed SovereignAgentHarness is live at 0xc90dFb7367CBD90c2874D819123571f566347E5D through Ritual's official SovereignAgentFactory.",
  "Use the explorer to verify deployment tx 0xdd17daee2f10ec9489898b5ff3660cdfd11942223c2a167d99f404b09322cd30.",
  "Live smoke proof executed agent #1 check #1 through tx 0xc2cfd5ee8d7e0106dd9a3067423731979e8f9c4b907b5f1e5a0762f1877e05fa.",
  "Point the frontend event feed at AgentRegistered, IntentSubmitted, DecisionRecorded, and WillExecuted.",
  "Use policyDigest/registerAgentSigned for off-chain policy approval without a relayer trust gap.",
  "Store policy and memory documents by CID, then anchor their hashes in CovenantKernel.",
  "Keep agent execution value inside its own bonded balance; executeApproved debits that bond before external calls.",
];

export const minimalAbiSketch = [
  "registerAgent(address agent, bytes32 policyHash, string memory cid, address successor)",
  "submitIntent(uint256 agentId, bytes calldata intent, uint256 value)",
  "recordDecision(uint256 checkId, uint8 decision, string memory reasonCid)",
  "slash(uint256 agentId, uint256 amount, address beneficiary)",
  "executeWill(uint256 agentId, string memory newMemoryCid)",
];

export const GUARDIAN_AGENT = {
  name: "CovenantGuardianAgent",
  status: "live deployed",
  address: "0xC5804673c09e0b492bc2371892c8c0270ef0878E",
  deploymentTx: "0x89d11d69c2171f87c2a2051fbc0785cc7e71ce1a6857988d8ba558cdcabc75b5",
  sourcePath: "CovenantGuardianAgent.sol",
  deployScript: "npm.cmd run contract:deploy:guardian",
  dryRunCommand: "set DRY_RUN=true&& npm.cmd run contract:deploy:guardian",
  localDeployGas: "2,684,461",
  deploymentGasUsed: "2,729,527",
  localFullFlowGas: "3,667,618",
  purpose:
    "A deterministic agent companion that can own a CovenantKernel agent, heartbeat it, submit guarded intents, score kernel intents, and write policy receipts when trusted as an attestor.",
};

export const GUARDIAN_LIVE_PROOF = {
  agentId: 2,
  checkId: 2,
  policyCid: "ipfs://ritual-covenant/guardian-live-policy",
  missionCid: "ipfs://ritual-covenant/guardian-live-mission",
  executionValue: "0.001",
  bondRemaining: "0.019",
  receiptHash: "0xabfe4b8a1981327b2be50cebda7cd47cd7bccfaf07b27b1c966a03d9ffa01935",
  latestTx: "0x602de1ae86a26601388bd3c19a2ad222e420c1fa7fbd3affe52de31aa59019b9",
  txs: [
    {
      label: "Trust Guardian attestor",
      hash: "0x3a17d45aed255bf34955fab46bf353360d766aabb091c888ffb8bc4c9465be74",
      gasUsed: "47859",
    },
    {
      label: "Allow live sink target",
      hash: "0x1737bf28d20f8b7dda0ff609ad9af698fa6d5f9b8997bfbdbf03af2a43fc4e1c",
      gasUsed: "47911",
    },
    {
      label: "Register Guardian agent",
      hash: "0x8a481317713cfd6b748937ad417dc2f7017f61854d580ee69b44d98a7b4ce6b5",
      gasUsed: "366858",
    },
    {
      label: "Submit Guardian intent",
      hash: "0x3e6a8db969d5f26693be76c2f84ba2daeee390fe66f4e128ad5fb8bd97996d68",
      gasUsed: "213804",
    },
    {
      label: "Record Guardian decision",
      hash: "0xfe628ccb56e7acb78ea7af0fcabf141aa0a46ab73e2cd41c015e498f54b45d2f",
      gasUsed: "327913",
    },
    {
      label: "Execute Guardian intent",
      hash: "0x602de1ae86a26601388bd3c19a2ad222e420c1fa7fbd3affe52de31aa59019b9",
      gasUsed: "85174",
    },
  ],
};

export const BOUNTY_JUDGE = {
  name: "CommitRevealBountyJudge",
  status: "live deployed",
  address: "0xf25720F49d877F4CAD539C6Bf0d2851B5e3Cb809",
  deploymentTx: "0x6ee694e8fdeecd64759034a130caec0b321381a4df73ebbd782fad4ab843b95f",
  deploymentGasUsed: "1,489,250",
  owner: "0xf6d02F13D7BB5fC24aB6A3D662619641958A3Cf6",
  codeBytes: "6,309",
  sourcePath: "CommitRevealBountyJudge.sol",
  testCommand: "npm.cmd run contract:bounty:test",
  deployCommand: "npm.cmd run contract:deploy:bounty",
  compileCommand: "npm.cmd run contract:compile",
  purpose:
    "A privacy-preserving bounty module where builders commit hidden answers first, reveal only after the commit window closes, and AI judging consumes one verified batch of eligible answers.",
  reflection:
    "Commitments, deadlines, revealed answer hashes, judge receipts, and the final winner should be public. Raw answers stay hidden during the submission phase so participants cannot copy each other. In the advanced Ritual-native path, plaintext should exist only inside the participant client and Ritual TEE batch judge until a public result is ready.",
};

export const COVENANT_SENTINEL = {
  name: "CovenantSentinelAgent",
  status: "live deployed",
  address: "0xa7Badcc7Cd6DD85936B2F72631aD1F804815f62c",
  deploymentTx: "0x50107a217e3498011ee4f6b9583b632c584a8d3f9c70511061e3e4ed1a50db07",
  harnessAddress: "0xc90dFb7367CBD90c2874D819123571f566347E5D",
  harnessDeployTx: "0x5597614da2a3a500dfb2e794b6cfc42749dc5a42981b28f205db889836c948f1",
  harnessStartTx: "0xa074ed45eb9187ecea832897a43a7c40c551a3f410f82cce75e4f6c285b55d20",
  factory: "0x9dC4C054e53bCc4Ce0A0Ff09E890A7a8e817f304",
  sourcePath: "CovenantSentinelAgent.sol",
  deployCommand: "npm.cmd run contract:deploy:sentinel",
  harnessCommand: "npm.cmd run contract:start:sovereign",
  purpose:
    "A project-native Sovereign Agent path: the Sentinel calls Ritual's 0x080C precompile, authenticates AsyncDelivery callbacks, and anchors a compact receipt for TEE returned policy analysis.",
};

export const contractMethods = [
  {
    name: "registerAgent",
    params: ["address agent", "bytes32 policyHash", "string cid", "address successor"],
    purpose: "Registers the agent identity, policy hash, memory pointer, and successor path.",
  },
  {
    name: "submitIntent",
    params: ["uint256 agentId", "bytes intent", "uint256 value"],
    purpose: "Receives an action proposal before funds, authority, or secrets move.",
  },
  {
    name: "recordDecision",
    params: ["uint256 checkId", "uint8 decision", "string reasonCid"],
    purpose: "Stores the policy result and the machine-readable enforcement reason.",
  },
  {
    name: "slash",
    params: ["uint256 agentId", "uint256 amount", "address beneficiary"],
    purpose: "Moves bonded value when an agent violates a covenant rule.",
  },
  {
    name: "executeWill",
    params: ["uint256 agentId", "string newMemoryCid"],
    purpose: "Transfers recovery state to the approved successor after heartbeat failure.",
  },
];

export const guardianMethods = [
  {
    name: "registerWithKernel",
    params: ["bytes32 policyHash", "string policyCid", "address successor"],
    purpose: "Links the Guardian contract as the owner of a CovenantKernel agent.",
  },
  {
    name: "pulseKernelHeartbeat",
    params: [],
    purpose: "Public keeper hook: anyone can pay gas to keep the agent heartbeat alive without getting control.",
  },
  {
    name: "submitGuardianIntent",
    params: ["address target", "uint256 value", "bytes callData", "uint64 ttl", "string missionCid"],
    purpose: "Submits executable intents through the kernel from the Guardian-owned agent.",
  },
  {
    name: "previewDecision",
    params: ["uint256 checkId"],
    purpose: "Scores an intent with on-chain facts before spending gas on the receipt.",
  },
  {
    name: "watchKernelIntent",
    params: ["uint256 checkId"],
    purpose: "Records Allowed, Blocked, or Slashed decisions in CovenantKernel if the Guardian is trusted as attestor.",
  },
  {
    name: "executeGuardianApproved",
    params: ["uint256 checkId", "bytes callData"],
    purpose: "Executes an approved intent from the Guardian agent's bonded kernel balance.",
  },
];

export const bountyJudgeMethods = [
  {
    name: "submitCommitment",
    params: ["uint256 bountyId", "bytes32 commitment"],
    purpose: "Stores only the commitment hash while answers remain hidden during the submission phase.",
  },
  {
    name: "revealAnswer",
    params: ["uint256 bountyId", "string answer", "bytes32 salt"],
    purpose: "Verifies keccak256(abi.encode(answer, salt, msg.sender, bountyId)) against the stored commitment.",
  },
  {
    name: "judgeAll",
    params: ["uint256 bountyId", "bytes llmInput"],
    purpose: "Anchors one canonical batch LLM input hash for all valid revealed answers.",
  },
  {
    name: "finalizeWinner",
    params: ["uint256 bountyId", "uint256 winnerIndex"],
    purpose: "Finalizes a winner only from the revealed eligible submission set.",
  },
];
