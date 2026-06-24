export const RITUAL_TESTNET = {
  chainName: "Ritual Chain Testnet",
  chainId: 1979,
  rpcUrl: "https://rpc.ritualfoundation.org",
  explorerUrl: "https://explorer.ritualfoundation.org",
  faucetUrl: "https://faucet.ritualfoundation.org",
  status: "live verified",
  covenantKernel: "0x4086710799f9d1Cb1eDb4D0a64522F00A5790270",
  covenantGuardian: "0xC5804673c09e0b492bc2371892c8c0270ef0878E",
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
