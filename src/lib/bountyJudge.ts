export const bountyJudgeAbi = [
  {
    type: "function",
    name: "createBounty",
    stateMutability: "nonpayable",
    inputs: [
      { name: "promptCid", type: "string" },
      { name: "promptHash", type: "bytes32" },
      { name: "commitDeadline", type: "uint64" },
      { name: "revealDeadline", type: "uint64" },
    ],
    outputs: [{ name: "bountyId", type: "uint256" }],
  },
  {
    type: "function",
    name: "submitCommitment",
    stateMutability: "nonpayable",
    inputs: [
      { name: "bountyId", type: "uint256" },
      { name: "commitment", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "revealAnswer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "bountyId", type: "uint256" },
      { name: "answer", type: "string" },
      { name: "salt", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "judgeAll",
    stateMutability: "nonpayable",
    inputs: [
      { name: "bountyId", type: "uint256" },
      { name: "llmInput", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "finalizeWinner",
    stateMutability: "nonpayable",
    inputs: [
      { name: "bountyId", type: "uint256" },
      { name: "winnerIndex", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getRevealedSubmissionCount",
    stateMutability: "view",
    inputs: [{ name: "bountyId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "nextBountyId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
