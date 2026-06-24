export const RITUAL_TESTNET = {
  chainName: "Ritual Chain Testnet",
  chainId: 1979,
  rpcUrl: "https://rpc.ritualfoundation.org",
  explorerUrl: "https://explorer.ritualfoundation.org",
  faucetUrl: "https://faucet.ritualfoundation.org",
  status: "live verified",
  covenantKernel: "0x4086710799f9d1Cb1eDb4D0a64522F00A5790270",
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
