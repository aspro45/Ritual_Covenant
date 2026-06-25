import { useEffect, useMemo, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { encodeAbiParameters, keccak256, stringToHex, type Address, type Hex } from "viem";
import { useAccount, useChainId, useReadContract } from "wagmi";
import {
  ArrowRight,
  BadgeCheck,
  BookOpenCheck,
  CheckCircle2,
  CircleDollarSign,
  Download,
  ExternalLink,
  FileCode2,
  Fingerprint,
  Gauge,
  HeartPulse,
  Home,
  KeyRound,
  LockKeyhole,
  RadioTower,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Vault,
  Workflow,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { BountyWorkbench } from "./components/BountyWorkbench";
import { CovenantScene } from "./components/CovenantScene";
import {
  clauses,
  contractModules,
  primitives,
  stackLinks,
  type CaseKind,
} from "./data/covenant";
import {
  contractIntegrationChecklist,
  contractMethods,
  BOUNTY_JUDGE,
  bountyJudgeMethods,
  COVENANT_SENTINEL,
  GUARDIAN_AGENT,
  GUARDIAN_LIVE_PROOF,
  guardianMethods,
  RITUAL_TESTNET,
} from "./lib/contracts";
import { fetchLiveCovenantState, type LiveCovenantState } from "./lib/onchain";
import { ritualTestnet } from "./lib/web3";

type PageId = "overview" | "brief" | "firewall" | "blackbox" | "bounty" | "agents" | "policy" | "inheritance" | "contracts" | "pitch";
type LiveStatus = "loading" | "live" | "error";

type CovenantCase = {
  id: string;
  title: string;
  kind: CaseKind;
  agent: string;
  clause: string;
  decision: string;
  remedy: string;
  tx: string;
  txHref?: string;
  confidence: number;
};

type HiddenJudgePacket = {
  version: "ritual.hiddenJudge.v1";
  bountyId: number;
  participant: Address;
  promptHash: Hex;
  commitment: Hex;
  salt: Hex;
  ciphertextHash: Hex;
  batchInputHash: Hex;
  encryption: {
    algorithm: "AES-GCM";
    kdf: "PBKDF2-SHA256";
    iv: string;
    ciphertext: string;
  };
  privacyMap: {
    plaintext: string;
    onChain: string[];
    offChain: string[];
    tee: string;
  };
};

const kernelReadAbi = [
  {
    type: "function",
    name: "nextAgentId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "nextCheckId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const routes: Array<{ id: PageId; label: string; icon: LucideIcon; kicker: string }> = [
  { id: "overview", label: "Command", icon: Home, kicker: "Control" },
  { id: "brief", label: "Brief", icon: ScrollText, kicker: "Read" },
  { id: "firewall", label: "Firewall", icon: ShieldAlert, kicker: "Gate" },
  { id: "blackbox", label: "Black Box", icon: Fingerprint, kicker: "Receipts" },
  { id: "bounty", label: "Bounty Judge", icon: LockKeyhole, kicker: "Commit-Reveal" },
  { id: "agents", label: "Agents", icon: RadioTower, kicker: "Fleet" },
  { id: "policy", label: "Policy Studio", icon: BookOpenCheck, kicker: "Limits" },
  { id: "inheritance", label: "Inheritance", icon: HeartPulse, kicker: "Recovery" },
  { id: "contracts", label: "Contracts", icon: TerminalSquare, kicker: "Deploy" },
  { id: "pitch", label: "Pitch", icon: Sparkles, kicker: "Edge" },
];

const ritualAssets = {
  logo: "/ritual/ritual-logo.jpg",
  cockpit: "/ritual/ritual-covenant-cockpit.png",
  floatCity: "/ritual/ritual-generated-sky-lane.png",
  airship: "/ritual/ritual-generated-bazaar.png",
  cityBillboard: "/ritual/ritual-generated-kernel-city.png",
  cloudRun: "/ritual/ritual-generated-cloud-run.png",
  bountyHero: "/ritual/ritual-bounty-judge-hero.png",
  bountyFlow: "/ritual/ritual-bounty-judge-flow.png",
};

const worldPanels = [
  {
    label: "Ritual science-fiction layer",
    title: "Contracts with a world around them.",
    detail:
      "The interface keeps the technical receipt flow, but wraps it in a hand-drawn Ritual operating room: flying agents, city-scale policy signage, and kernel-level enforcement.",
    image: ritualAssets.cloudRun,
  },
  {
    label: "Sky intent lane",
    title: "Agent actions enter the gate before value moves.",
    detail: "Flying operators route intents through a policy gate before funds, secrets, or authority can move.",
    image: ritualAssets.floatCity,
  },
  {
    label: "Covenant bazaar",
    title: "Policies, memory CIDs, and successors are visible to operators.",
    detail: "A market-like control layer where signed policy terms, memory capsules, and successor paths stay inspectable.",
    image: ritualAssets.airship,
  },
  {
    label: "Smart-contract city",
    title: "Kernel receipts turn enforcement into a public trail.",
    detail: "A city-scale receipt layer makes every blocked, slashed, allowed, or inherited decision easy to replay.",
    image: ritualAssets.cityBillboard,
  },
];

const modeLabel: Record<CaseKind, string> = {
  allowed: "Allowed",
  blocked: "Blocked",
  slashed: "Slashed",
  revived: "Inherited",
};

const decisionIcon: Record<CaseKind, LucideIcon> = {
  allowed: CheckCircle2,
  blocked: ShieldAlert,
  slashed: XCircle,
  revived: Workflow,
};

const pageCopy: Record<PageId, { title: string; subtitle: string }> = {
  overview: {
    title: "Agent Policy Firewall",
    subtitle: "Operational controls for agents that spend, store secrets, and recover from failure.",
  },
  brief: {
    title: "Project Brief",
    subtitle: "A readable technical article for judges, developers, and operators reviewing Covenant.",
  },
  firewall: {
    title: "Intent Enforcement",
    subtitle: "Risky agent actions are checked before funds, data keys, or authority move.",
  },
  blackbox: {
    title: "Covenant Black Box",
    subtitle: "A flight recorder for autonomous-agent decisions, policy proofs, and recovery actions.",
  },
  bounty: {
    title: "Commit-Reveal Bounty",
    subtitle: "Hidden submissions, verified reveals, batch AI judging, and public winner finalization.",
  },
  agents: {
    title: "Protected Agent Fleet",
    subtitle: "Every autonomous actor gets liveness, wallet, secret, and policy telemetry.",
  },
  policy: {
    title: "Signed Policy Studio",
    subtitle: "Compose the limits an agent must respect before it executes.",
  },
  inheritance: {
    title: "Machine Inheritance",
    subtitle: "Missed heartbeats become recoverable system events instead of lost agents.",
  },
  contracts: {
    title: "Contract Wiring",
    subtitle: "ABI calls, live receipts, and deployment proof for testnet wiring.",
  },
  pitch: {
    title: "Competition Positioning",
    subtitle: "Not another judge, court, or dead-man switch. A policy firewall for non-human actors.",
  },
};

const inheritanceSteps = [
  {
    label: "Heartbeat miss",
    detail: "Agent fails four scheduler windows.",
    icon: HeartPulse,
    state: "detected",
  },
  {
    label: "Spending freeze",
    detail: "CovenantKernel blocks new high-risk intents.",
    icon: LockKeyhole,
    state: "sealed",
  },
  {
    label: "Secret re-key",
    detail: "DKMS path moves access to the successor.",
    icon: KeyRound,
    state: "rotated",
  },
  {
    label: "Successor funded",
    detail: "Bond lane releases recovery budget and memory CID.",
    icon: Vault,
    state: "inherited",
  },
];

const pitchRows = [
  ["AI Judge", "Human disputes", "Covenant enforces agent actions before execution."],
  ["Bounty Judge", "Public answers get copied", "Commit-reveal hides answers until the reveal window."],
  ["Dead-Man Switch", "Human estate transfer", "Covenant recovers autonomous agents and their operating state."],
  ["Agent Dashboard", "Read-only monitoring", "Covenant can block, slash, freeze, and inherit."],
  ["Bounty Agent", "Task escrow", "Covenant governs the agent's own spending, secrets, and authority."],
];

const deployRoute = [
  {
    label: "Kernel deployed",
    detail: "CovenantKernel is deployed on Ritual Chain Testnet and read directly from the frontend.",
  },
  {
    label: "Agent registered",
    detail: "Agent #1, successor, policy hash, and bonded value are stored in contract state.",
  },
  {
    label: "Intent executed",
    detail: "The live proof reads the recorded decision and execution receipt from chain.",
  },
  {
    label: "Submit proof",
    detail: "Use the contract address and tx hashes as the public competition proof.",
  },
];

const guardianRows = [
  ["Live agent", `kernel agent #${GUARDIAN_LIVE_PROOF.agentId}`],
  ["Live check", `check #${GUARDIAN_LIVE_PROOF.checkId} / Allowed`],
  ["Execution", `${GUARDIAN_LIVE_PROOF.executionValue} RITUAL moved`],
  ["Receipt", shortHash(GUARDIAN_LIVE_PROOF.receiptHash, 8, 6)],
];

const sentinelRows = [
  ["Consumer", shortHash(COVENANT_SENTINEL.address, 8, 6)],
  ["Harness", shortHash(COVENANT_SENTINEL.harnessAddress, 8, 6)],
  ["Factory", shortHash(COVENANT_SENTINEL.factory, 8, 6)],
  ["Runtime", "Sovereign Agent 0x080C"],
];

const builderXUrl = "https://x.com/ASPRO_22";

const briefSections = [
  {
    title: "The problem",
    body:
      "Autonomous agents can hold funds, call contracts, rely on secrets, and disappear when a key, scheduler, or operator path fails. Most tools only observe the failure after execution.",
  },
  {
    title: "The primitive",
    body:
      "CovenantKernel turns agent risk into a pre-execution policy path: register the agent, submit an intent, record an attested decision, then execute, slash, cool down, or hand off to a successor.",
  },
  {
    title: "Why it matters",
    body:
      "The project makes policy operational instead of advisory. Every important action leaves a receipt that developers can inspect on Ritual Chain Testnet.",
  },
];

const briefFlow = [
  "Agent registers policy, successor, memory CID, and bond.",
  "A proposed action enters the intent gate before value moves.",
  "The policy decision is written as a machine-readable receipt.",
  "Allowed actions execute; unsafe actions can be blocked, slashed, or inherited.",
];

const bountyFlow = [
  "Builder submits only a commitment hash during the commit phase.",
  "After the deadline, the builder reveals the answer and salt.",
  "The contract verifies the reveal against sender and bounty ID.",
  "A single batch LLM input is anchored before the winner is finalized.",
];

const bountyArchitecture = [
  { name: "Hidden first", icon: LockKeyhole, text: "Answers are not public during the submission window." },
  { name: "Verified reveal", icon: BadgeCheck, text: "Wrong salts, copied answers, and missing commits are rejected." },
  { name: "Batch judging", icon: Workflow, text: "The AI receives one canonical set of eligible revealed answers." },
];

const bountyReplaySteps = [
  {
    label: "Public answer appears",
    public: "A strong answer is readable by every participant during the submission window.",
    covenant: "Only a commitment hash is visible. The answer and salt stay off the public board.",
  },
  {
    label: "Copycat reacts",
    public: "A late participant copies the idea, improves the wording, and submits after seeing the original.",
    covenant: "The copycat can copy a hash, but cannot reveal it from a different wallet.",
  },
  {
    label: "Reveal window opens",
    public: "The judge sees two similar answers and cannot prove who was first.",
    covenant: "The contract checks answer, salt, sender, and bounty ID before eligibility.",
  },
  {
    label: "Batch AI judging",
    public: "The batch contains contaminated submissions.",
    covenant: "Only verified revealed answers enter one canonical AI judging batch.",
  },
];

const bountyReceiptSteps = [
  {
    event: "Commitment submitted",
    proof: "hash only",
    check: "No plaintext answer during commit phase.",
  },
  {
    event: "Answer revealed",
    proof: "sender-bound",
    check: "Reveal must match answer, salt, wallet, and bounty ID.",
  },
  {
    event: "Batch judged",
    proof: "single input hash",
    check: "One LLM batch covers all eligible submissions.",
  },
  {
    event: "Winner finalized",
    proof: "eligible index",
    check: "Winner must come from revealed submission IDs.",
  },
];

const bountySdkSnippets = [
  {
    name: "computeCommitment",
    text: "Hash answer + salt + sender + bountyId before the answer is public.",
  },
  {
    name: "buildJudgeBatch",
    text: "Pack prompt, revealed IDs, answer hashes, and rubric into one AI input.",
  },
  {
    name: "verifyReveal",
    text: "Reject wrong salts, copied hashes, duplicate reveals, and expired windows.",
  },
];

const hiddenJudgeFlow = [
  {
    title: "Client seals answer",
    text: "The builder keeps plaintext in the browser, generates the normal commitment, and encrypts the answer into a sealed packet.",
  },
  {
    title: "Chain sees proofs",
    text: "The contract stores commitment, deadlines, reveal eligibility, and the final batch hash instead of leaking answers early.",
  },
  {
    title: "TEE judges once",
    text: "A Ritual-backed judge can decrypt the eligible batch inside the enclave and submit one scored result receipt.",
  },
];

const hiddenJudgePublicFields = ["bountyId", "commitment", "ciphertextHash", "batchInputHash", "winner"];
const hiddenJudgePrivateFields = ["raw answer", "secret phrase", "TEE decrypted batch"];

const blackBoxLayers = [
  {
    id: "intent",
    label: "Intent",
    icon: TerminalSquare,
    title: "What did the agent try to do?",
    text: "The recorder binds target, value, calldata hash, submitter, TTL, and the active kernel address before execution can happen.",
    proof: "intentHash",
  },
  {
    id: "policy",
    label: "Policy",
    icon: ShieldCheck,
    title: "Which rule was active?",
    text: "The receipt keeps the policy hash with the action, so a reviewer can compare the decision against the exact signed operating boundary.",
    proof: "policyHash",
  },
  {
    id: "decision",
    label: "Decision",
    icon: BadgeCheck,
    title: "Who approved, blocked, slashed, or inherited?",
    text: "CovenantKernel records the decision, attestor, reason hash, reason CID, and receipt hash as a machine-readable audit record.",
    proof: "receiptHash",
  },
  {
    id: "remedy",
    label: "Remedy",
    icon: Workflow,
    title: "What happened after the decision?",
    text: "Allowed actions can execute; unsafe actions can stop, cool down, slash bonded value, or open the successor path after heartbeat failure.",
    proof: "execution",
  },
] as const;

const blackBoxSchema = [
  ["intentHash", "Sender-bound action hash for replay protection."],
  ["policyHash", "Exact policy active when the decision was made."],
  ["reasonHash", "Machine-readable reason behind the outcome."],
  ["receiptHash", "Canonical receipt tying check, agent, policy, intent, and decision."],
  ["remedy", "Allowed, blocked, slashed, cooled down, or inherited result."],
  ["explorer", "Public tx link for reviewers and downstream tools."],
];

function classForKind(kind: CaseKind) {
  return `tone-${kind}`;
}

function shortHash(value: string, head = 6, tail = 4) {
  return value.length > head + tail + 3 ? `${value.slice(0, head)}...${value.slice(-tail)}` : value;
}

function bytesToHex(bytes: Uint8Array) {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function normalizeBytes32(input: string): Hex {
  const trimmed = input.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) return trimmed as Hex;
  return keccak256(stringToHex(trimmed || "ritual-hidden-judge"));
}

async function encryptForHiddenJudge(answer: string, secret: string) {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret || "ritual-covenant-hidden-judge"),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: 120_000,
      salt: encoder.encode("ritual-covenant-hidden-judge-v1"),
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(answer));

  return {
    iv: bytesToHex(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
  };
}

function decisionKind(decision: string): CaseKind {
  if (decision === "Blocked") return "blocked";
  if (decision === "Slashed") return "slashed";
  if (decision === "Inherited") return "revived";
  return "allowed";
}

function digestPayload(payload: unknown) {
  return keccak256(stringToHex(JSON.stringify(payload)));
}

function bound(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function assessIntent({
  spendCap,
  intentSpend,
  secretLock,
  touchesSecret,
  missedHeartbeats,
  heartbeatLimit,
  targetAllowed,
  severity,
}: {
  spendCap: number;
  intentSpend: number;
  secretLock: boolean;
  touchesSecret: boolean;
  missedHeartbeats: number;
  heartbeatLimit: number;
  targetAllowed: boolean;
  severity: string;
}) {
  const strictBoost = severity === "strict" ? 10 : severity === "quiet" ? -8 : 0;
  const risk =
    intentSpend * 2.2 +
    (touchesSecret && secretLock ? 34 : 0) +
    (!targetAllowed ? 26 : 0) +
    Math.max(0, missedHeartbeats - heartbeatLimit + 1) * 18 +
    strictBoost;

  if (missedHeartbeats >= heartbeatLimit + 1) {
    return {
      kind: "revived" as CaseKind,
      label: "INHERIT",
      reason: `Heartbeat failed for ${missedHeartbeats} epochs; successor path opens before new execution.`,
      confidence: bound(Math.round(72 + missedHeartbeats * 3), 78, 99),
    };
  }

  if (intentSpend > spendCap * 1.75 || (!targetAllowed && touchesSecret)) {
    return {
      kind: "slashed" as CaseKind,
      label: "SLASH",
      reason: "The intent combines policy breach with high-risk authority, so bond consequences are triggered.",
      confidence: bound(Math.round(risk), 78, 99),
    };
  }

  if (intentSpend > spendCap || (secretLock && touchesSecret) || !targetAllowed) {
    return {
      kind: "blocked" as CaseKind,
      label: "BLOCK",
      reason: "The action is stopped before value, target authority, or secrets move.",
      confidence: bound(Math.round(64 + risk / 3), 70, 96),
    };
  }

  return {
    kind: "allowed" as CaseKind,
    label: "ALLOW",
    reason: "The action stays inside signed policy limits and can move to execution.",
    confidence: bound(100 - Math.round(risk / 3), 82, 100),
  };
}

function caseFromLive(liveState: LiveCovenantState | null, liveStatus: LiveStatus, liveError: string | null): CovenantCase[] {
  if (!liveState) {
    return [
      {
        id: "ONCHAIN",
        title: liveStatus === "error" ? "RPC read failed" : "Reading Ritual chain",
        kind: liveStatus === "error" ? "blocked" : "allowed",
        agent: "Ritual Chain Testnet",
        clause: liveError ?? "Fetching CovenantKernel storage, receipts, and tx status from Ritual RPC.",
        decision: liveStatus === "error" ? "RPC ERROR" : "LOADING",
        remedy: "Verified RPC data is required before values are displayed.",
        tx: "pending",
        confidence: liveStatus === "error" ? 0 : 100,
      },
    ];
  }

  const executeTx = liveState.txs.find((tx) => tx.label.toLowerCase().includes("execute")) ?? liveState.txs[liveState.txs.length - 1];
  const executed = liveState.intent.executed ? "executed" : "not executed";
  const kind = decisionKind(liveState.receipt.decision);

  return [
    {
      id: `CK-${liveState.checkId.padStart(4, "0")}`,
      title: `${liveState.receipt.decision} intent ${executed}`,
      kind,
      agent: `Agent #${liveState.agentId}`,
      clause: `Target ${shortHash(liveState.intent.target)} received an approved ${liveState.intent.value} RITUAL intent from CovenantKernel.`,
      decision: `${liveState.receipt.decision.toUpperCase()} / ${liveState.intent.executed ? "EXECUTED" : "OPEN"}`,
      remedy: `Sink received ${liveState.sink.received} RITUAL. Agent bond remaining: ${liveState.agent.bond} RITUAL.`,
      tx: shortHash(executeTx.hash, 8, 6),
      txHref: `${RITUAL_TESTNET.explorerUrl}/tx/${executeTx.hash}`,
      confidence: liveState.receipt.decision === "Allowed" && liveState.intent.executed ? 100 : 84,
    },
  ];
}

function getHashPage(): PageId {
  const hash = window.location.hash.replace("#", "") as PageId;
  return routes.some((route) => route.id === hash) ? hash : "overview";
}

function StatPill({ label, value, icon: Icon, tone = "green" }: { label: string; value: string; icon: LucideIcon; tone?: string }) {
  return (
    <div className={`stat-pill tone-${tone}`}>
      <Icon size={17} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DecisionBadge({ kind }: { kind: CaseKind }) {
  const Icon = decisionIcon[kind];
  return (
    <span className={`decision-badge ${classForKind(kind)}`}>
      <Icon size={15} />
      {modeLabel[kind]}
    </span>
  );
}

function CaseStrip({
  cases,
  selected,
  onSelect,
}: {
  cases: CovenantCase[];
  selected: CovenantCase;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="case-strip" aria-label="Policy checks">
      {cases.map((item) => (
        <button
          className={`case-tile ${item.id === selected.id ? "active" : ""} ${classForKind(item.kind)}`}
          key={item.id}
          onClick={() => onSelect(item.id)}
        >
          <span className="case-id">{item.id}</span>
          <strong>{item.title}</strong>
          <DecisionBadge kind={item.kind} />
        </button>
      ))}
    </div>
  );
}

function EnforcementPanel({ selected }: { selected: CovenantCase }) {
  const Icon = decisionIcon[selected.kind];
  return (
    <section className={`enforcement-panel ${classForKind(selected.kind)}`}>
      <div className="panel-title-row">
        <span>Live Enforcement</span>
        <strong>{selected.id}</strong>
      </div>
      <div className="decision-headline">
        <Icon size={34} />
        <h2>{selected.decision}</h2>
      </div>
      <p>{selected.clause}</p>
      <div className="evidence-grid">
        <div>
          <span>Agent</span>
          <strong>{selected.agent}</strong>
        </div>
        <div>
          <span>Confidence</span>
          <strong>{selected.confidence}%</strong>
        </div>
        <div>
          <span>Remedy</span>
          <strong>{selected.remedy}</strong>
        </div>
        <div>
          <span>Receipt</span>
          {selected.txHref ? (
            <a href={selected.txHref} target="_blank" rel="noreferrer">
              {selected.tx}
            </a>
          ) : (
            <strong>{selected.tx}</strong>
          )}
        </div>
      </div>
    </section>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="page-shell">{children}</div>;
}

function WorldGallery() {
  const [activeIndex, setActiveIndex] = useState(0);

  return (
    <section className="world-gallery" aria-label="Ritual visual system">
      {worldPanels.map((panel, index) => {
        const isActive = activeIndex === index;

        return (
          <button
            aria-pressed={isActive}
            className={`world-panel ${isActive ? "expanded" : "collapsed"}`}
            key={panel.label}
            onClick={() => setActiveIndex(index)}
            type="button"
          >
            <img src={panel.image} alt="" />
            <div>
              <span>{panel.label}</span>
              {isActive ? (
                <>
                  <h3>{panel.title}</h3>
                  <p className="world-detail">{panel.detail}</p>
                </>
              ) : (
                <p className="world-title">{panel.title}</p>
              )}
            </div>
          </button>
        );
      })}
    </section>
  );
}

function LiveProofConsole({
  liveState,
  liveStatus,
  liveError,
}: {
  liveState: LiveCovenantState | null;
  liveStatus: LiveStatus;
  liveError: string | null;
}) {
  const proofPayload = useMemo(
    () => ({
      source: "Ritual Chain Testnet RPC",
      status: liveStatus,
      error: liveError,
      state: liveState,
    }),
    [liveError, liveState, liveStatus],
  );

  const receiptHref = useMemo(
    () => `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(proofPayload, null, 2))}`,
    [proofPayload],
  );

  const receiptRows = liveState
    ? [
        ["chain", `${RITUAL_TESTNET.chainName} / ${liveState.chainId}`],
        ["kernel", shortHash(liveState.kernelAddress, 8, 6)],
        ["agent", `#${liveState.agentId} ${shortHash(liveState.agent.owner, 8, 6)}`],
        ["check", `#${liveState.checkId}`],
        ["decision", liveState.receipt.decision],
        ["executed", liveState.intent.executed ? "true" : "false"],
        ["intentValue", `${liveState.intent.value} RITUAL`],
        ["bondRemaining", `${liveState.agent.bond} RITUAL`],
        ["sinkReceived", `${liveState.sink.received} RITUAL`],
        ["receiptHash", shortHash(liveState.receipt.receiptHash, 10, 8)],
      ]
    : [
        ["chain", RITUAL_TESTNET.chainName],
        ["kernel", shortHash(RITUAL_TESTNET.covenantKernel, 8, 6)],
        ["status", liveStatus],
        ["message", liveError ?? "Fetching on-chain state from Ritual RPC."],
      ];

  const headline = liveState
    ? `Agent #${liveState.agentId} executed check #${liveState.checkId} through CovenantKernel.`
    : "Reading CovenantKernel from Ritual Chain Testnet.";

  return (
    <section className={`trial-console ${classForKind(liveStatus === "error" ? "blocked" : "allowed")}`}>
      <div className="trial-head">
        <div>
          <span>On-chain proof</span>
          <h3>Live Covenant receipt</h3>
        </div>
        <strong>{liveStatus === "live" ? "rpc verified" : liveStatus}</strong>
      </div>

      <div className="trial-actions" aria-label="Live explorer links">
        <a className="trial-button active" href={`${RITUAL_TESTNET.explorerUrl}/address/${RITUAL_TESTNET.covenantKernel}`} target="_blank" rel="noreferrer">
          <TerminalSquare size={17} />
          <span>Kernel</span>
        </a>
        {liveState && (
          <a className="trial-button" href={`${RITUAL_TESTNET.explorerUrl}/tx/${liveState.txs[liveState.txs.length - 1].hash}`} target="_blank" rel="noreferrer">
            <ExternalLink size={17} />
            <span>Execution tx</span>
          </a>
        )}
      </div>

      <div className="trial-body">
        <div className="trial-sequence">
          <div className="trial-outcome">
            <span>{liveState ? `block ${liveState.latestBlock}` : "rpc pending"}</span>
            <h3>{headline}</h3>
            <DecisionBadge kind={liveStatus === "error" ? "blocked" : "allowed"} />
          </div>

          <div className="trial-steps">
            {(liveState?.txs ?? []).map((tx, index) => (
              <a
                className={`trial-step ${tx.status === "success" ? "complete" : "active"}`}
                href={`${RITUAL_TESTNET.explorerUrl}/tx/${tx.hash}`}
                key={tx.hash}
                target="_blank"
                rel="noreferrer"
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{tx.label}</strong>
                  <p>Block {tx.blockNumber}; gas {tx.gasUsed}; status {tx.status}.</p>
                </div>
                <em>{shortHash(tx.hash, 8, 6)}</em>
              </a>
            ))}
            {!liveState && (
              <div className={`trial-step ${liveStatus === "error" ? "active" : "queued"}`}>
                <span>01</span>
                <div>
                  <strong>{liveStatus === "error" ? "RPC error" : "Reading chain"}</strong>
                  <p>{liveError ?? "Waiting for Ritual RPC response."}</p>
                </div>
                <em>{liveStatus}</em>
              </div>
            )}
          </div>
        </div>

        <aside className="receipt-panel">
          <div className="receipt-title">
            <ScrollText size={18} />
            <div>
              <span>Decision Receipt</span>
              <strong>{liveState ? liveState.receipt.decision : liveStatus}</strong>
            </div>
          </div>
          <div className="receipt-grid">
            {receiptRows.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <a className="receipt-download" href={receiptHref} download="ritual-covenant-live-onchain.json">
            <Download size={16} />
            On-chain JSON
          </a>
        </aside>
      </div>
    </section>
  );
}

function OverviewPage({
  cases,
  selected,
  onSelect,
  go,
  liveState,
  liveStatus,
  liveError,
}: {
  cases: CovenantCase[];
  selected: CovenantCase;
  onSelect: (id: string) => void;
  go: (page: PageId) => void;
  liveState: LiveCovenantState | null;
  liveStatus: LiveStatus;
  liveError: string | null;
}) {
  const agentCount = liveState ? String(Math.max(0, Number(liveState.nextAgentId) - 1)) : liveStatus;
  const checkCount = liveState ? String(Math.max(0, Number(liveState.nextCheckId) - 1)) : liveStatus;
  const executionState = liveState ? (liveState.intent.executed ? "executed" : "open") : liveError ? "rpc error" : "reading";

  return (
    <PageShell>
      <section className="overview-grid">
        <div className="command-hero">
          <img className="hero-watermark" src={ritualAssets.logo} alt="" />
          <span className="eyebrow">
            <Sparkles size={16} />
            Policy runtime
          </span>
          <h1>Covenant makes agent money enforceable.</h1>
          <p>
            A policy firewall for autonomous agents: pre-execution intent checks, vault escrow, secret controls,
            heartbeat recovery, and successor handoff.
          </p>
          <div className="action-row">
            <button className="primary-action" onClick={() => onSelect(cases[0].id)}>
              <ShieldAlert size={18} />
              View live receipt
            </button>
            <button className="secondary-action" onClick={() => go("agents")}>
              <HeartPulse size={18} />
              Agent state
            </button>
            <button className="ghost-action" onClick={() => go("policy")}>
              <ScrollText size={18} />
              Policy studio
            </button>
          </div>
          <div className="hero-callouts" aria-label="Covenant kernel highlights">
            <span>signed policy</span>
            <span>intent gate</span>
            <span>heartbeat will</span>
          </div>
        </div>
        <EnforcementPanel selected={selected} />
      </section>

      <LiveProofConsole liveState={liveState} liveStatus={liveStatus} liveError={liveError} />
      <WorldGallery />

      <section className="status-ledger">
        <StatPill label="On-chain agents" value={agentCount} icon={RadioTower} />
        <StatPill label="On-chain checks" value={checkCount} icon={Gauge} />
        <StatPill label="Kernel balance" value={liveState ? `${liveState.kernelBalance} RITUAL` : liveStatus} icon={CircleDollarSign} tone="cyan" />
        <StatPill label="Execution" value={executionState} icon={ShieldAlert} tone={liveState?.intent.executed ? "green" : "amber"} />
        <StatPill label="Sink received" value={liveState ? `${liveState.sink.received} RITUAL` : liveStatus} icon={KeyRound} tone="cyan" />
      </section>

      <CaseStrip cases={cases} selected={selected} onSelect={onSelect} />

      <section className="flow-band">
        {["Intent", "Policy", "Vault", "Secret", "Inheritance"].map((label, index) => (
          <div className="flow-step" key={label}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{label}</strong>
            <p>{["submitted", "checked", "settled", "guarded", "recoverable"][index]}</p>
          </div>
        ))}
      </section>
    </PageShell>
  );
}

function FirewallPage({
  cases,
  selected,
  onSelect,
  liveState,
  liveStatus,
}: {
  cases: CovenantCase[];
  selected: CovenantCase;
  onSelect: (id: string) => void;
  liveState: LiveCovenantState | null;
  liveStatus: LiveStatus;
}) {
  const [intentSpend, setIntentSpend] = useState(8);
  const [targetAllowed, setTargetAllowed] = useState(true);
  const [touchesSecret, setTouchesSecret] = useState(false);
  const [missedHeartbeats, setMissedHeartbeats] = useState(0);
  const simulated = assessIntent({
    spendCap: 12,
    intentSpend,
    secretLock: true,
    touchesSecret,
    missedHeartbeats,
    heartbeatLimit: 4,
    targetAllowed,
    severity: "balanced",
  });
  const simulatedReceipt = useMemo(
    () =>
      digestPayload({
        intentSpend,
        targetAllowed,
        touchesSecret,
        missedHeartbeats,
        decision: simulated.label,
        kernel: RITUAL_TESTNET.covenantKernel,
      }),
    [intentSpend, missedHeartbeats, simulated.label, targetAllowed, touchesSecret],
  );
  const simulatedSteps = [
    ["Decode calldata", `${intentSpend}% treasury intent`],
    ["Check target", targetAllowed ? "allowlist match" : "unknown target"],
    ["Secret rule", touchesSecret ? "private key path touched" : "no secret access"],
    ["Heartbeat", `${missedHeartbeats} missed epochs`],
    ["Receipt", shortHash(simulatedReceipt, 10, 8)],
  ];

  return (
    <PageShell>
      <section className="two-column firewall-layout">
        <div className="surface-panel firewall-console">
          <div className="firewall-head">
            <div>
              <span>Intent Queue</span>
              <h3>Pre-execution checks</h3>
            </div>
            <div className="queue-metric">
              <strong>{cases.length}</strong>
              <span>on-chain checks</span>
            </div>
          </div>
          <CaseStrip cases={cases} selected={selected} onSelect={onSelect} />
          <div className={`queue-summary ${classForKind(selected.kind)}`}>
            <div>
              <span>Active intent</span>
              <strong>
                {selected.id} / {selected.agent}
              </strong>
            </div>
            <div>
              <span>Policy confidence</span>
              <strong>{selected.confidence}%</strong>
            </div>
            <DecisionBadge kind={selected.kind} />
          </div>
          <div className={`intent-simulator ${classForKind(simulated.kind)}`}>
            <div className="simulator-head">
              <div>
                <span>Local intent simulator</span>
                <h3>{simulated.label} / {simulated.confidence}%</h3>
              </div>
              <DecisionBadge kind={simulated.kind} />
            </div>
            <div className="simulator-controls">
              <label className="control-row compact-control">
                <span>Treasury value</span>
                <strong>{intentSpend}%</strong>
                <input type="range" min="0" max="42" value={intentSpend} onChange={(event) => setIntentSpend(Number(event.target.value))} />
              </label>
              <label className="toggle-row compact-toggle">
                <span>
                  <ShieldCheck size={16} />
                  Target allowlisted
                </span>
                <input type="checkbox" checked={targetAllowed} onChange={(event) => setTargetAllowed(event.target.checked)} />
              </label>
              <label className="toggle-row compact-toggle">
                <span>
                  <KeyRound size={16} />
                  Touches secrets
                </span>
                <input type="checkbox" checked={touchesSecret} onChange={(event) => setTouchesSecret(event.target.checked)} />
              </label>
              <label className="control-row compact-control">
                <span>Missed heartbeats</span>
                <strong>{missedHeartbeats}</strong>
                <input type="range" min="0" max="7" value={missedHeartbeats} onChange={(event) => setMissedHeartbeats(Number(event.target.value))} />
              </label>
            </div>
            <p>{simulated.reason}</p>
            <div className="simulator-steps">
              {simulatedSteps.map(([label, value], index) => (
                <div key={label}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{label}</strong>
                  <em>{value}</em>
                </div>
              ))}
            </div>
          </div>
          <div className="trace-list">
            {(liveState?.txs ?? []).map((tx, index) => (
              <a className="trace-row" href={`${RITUAL_TESTNET.explorerUrl}/tx/${tx.hash}`} key={tx.hash} target="_blank" rel="noreferrer">
                <span>{index + 1}</span>
                <div>
                  <p>{tx.label}</p>
                  <em>Block {tx.blockNumber}; tx {shortHash(tx.hash, 8, 6)}</em>
                </div>
                <strong>{tx.gasUsed}</strong>
                <CheckCircle2 size={17} />
              </a>
            ))}
            {!liveState && (
              <div className="trace-row">
                <span>1</span>
                <div>
                  <p>{liveStatus === "error" ? "RPC error" : "Reading on-chain proof"}</p>
                  <em>CovenantKernel state is fetched from Ritual RPC.</em>
                </div>
                <strong>{liveStatus}</strong>
                <CheckCircle2 size={17} />
              </div>
            )}
          </div>
        </div>
        <EnforcementPanel selected={selected} />
      </section>

      <section className="primitive-grid compact">
        {primitives.map(({ name, icon: Icon, detail, state }) => (
          <article className="primitive-item" key={name}>
            <Icon size={22} />
            <h3>{name}</h3>
            <p>{detail}</p>
            <strong>{state}</strong>
          </article>
        ))}
      </section>
    </PageShell>
  );
}

function BlackBoxPage({
  liveState,
  liveStatus,
  liveError,
}: {
  liveState: LiveCovenantState | null;
  liveStatus: LiveStatus;
  liveError: string | null;
}) {
  const [activeLayer, setActiveLayer] = useState<(typeof blackBoxLayers)[number]["id"]>("decision");
  const activeLayerMeta = blackBoxLayers.find((layer) => layer.id === activeLayer) ?? blackBoxLayers[0];
  const finalTx = liveState?.txs[liveState.txs.length - 1];
  const receiptHash =
    liveState?.receipt.receiptHash ??
    digestPayload({
      status: liveStatus,
      kernel: RITUAL_TESTNET.covenantKernel,
      message: liveError ?? "waiting for Ritual RPC",
    });
  const blackBoxPayload = useMemo(
    () => ({
      version: "covenant.blackbox.v1",
      chain: RITUAL_TESTNET.chainName,
      kernel: RITUAL_TESTNET.covenantKernel,
      liveStatus,
      fetchedAt: liveState?.fetchedAt ?? new Date().toISOString(),
      checkId: liveState?.checkId ?? null,
      agentId: liveState?.agentId ?? null,
      intent: liveState?.intent ?? null,
      receipt: liveState?.receipt ?? null,
      remedy: liveState
        ? liveState.intent.executed
          ? `Executed. Sink received ${liveState.sink.received} RITUAL.`
          : `${liveState.receipt.decision} receipt recorded; execution is not marked complete.`
        : liveError ?? "Ritual RPC read pending.",
      explorer: finalTx ? `${RITUAL_TESTNET.explorerUrl}/tx/${finalTx.hash}` : `${RITUAL_TESTNET.explorerUrl}/address/${RITUAL_TESTNET.covenantKernel}`,
    }),
    [finalTx, liveError, liveState, liveStatus],
  );
  const receiptDownload = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(blackBoxPayload, null, 2))}`;
  const recorderRows = liveState
    ? [
        ["agent", `#${liveState.agentId}`],
        ["check", `#${liveState.checkId}`],
        ["decision", liveState.receipt.decision],
        ["intent", shortHash(liveState.intent.intentHash, 10, 8)],
        ["policy", shortHash(liveState.receipt.policyHash, 10, 8)],
        ["receipt", shortHash(liveState.receipt.receiptHash, 10, 8)],
      ]
    : [
        ["agent", "pending"],
        ["check", "pending"],
        ["decision", liveStatus],
        ["intent", shortHash(receiptHash, 10, 8)],
        ["policy", shortHash(RITUAL_TESTNET.covenantKernel, 10, 8)],
        ["receipt", liveError ? "rpc error" : "reading"],
      ];
  const investigationTrail = liveState
    ? [
        ["01", "Intent captured", `Target ${shortHash(liveState.intent.target, 8, 6)} with ${liveState.intent.value} RITUAL value.`],
        ["02", "Policy bound", `Policy hash ${shortHash(liveState.receipt.policyHash, 10, 8)} stayed attached to the receipt.`],
        ["03", "Decision recorded", `${liveState.receipt.decision} by attestor ${shortHash(liveState.receipt.attestor, 8, 6)}.`],
        ["04", "Remedy verified", liveState.intent.executed ? `Execution tx ${shortHash(finalTx?.hash ?? "", 8, 6)} moved value after approval.` : "No execution marked after the receipt."],
      ]
    : [
        ["01", "Kernel selected", shortHash(RITUAL_TESTNET.covenantKernel, 10, 8)],
        ["02", "RPC state", liveError ?? "Waiting for CovenantKernel storage."],
        ["03", "Receipt export", "The recorder will export the current chain read as JSON."],
        ["04", "Reviewer path", "Use the kernel and tx links to inspect the source of truth."],
      ];

  return (
    <PageShell>
      <section className="blackbox-hero">
        <article className="blackbox-copy">
          <span className="eyebrow">
            <Fingerprint size={16} />
            Agent flight recorder
          </span>
          <h1>Every autonomous action leaves an explainable black box.</h1>
          <p>
            Covenant Black Box turns the existing kernel receipt into an investigation trail: what the agent tried,
            which policy applied, who attested the decision, and what remedy followed.
          </p>
          <div className="brief-meta" aria-label="Black Box proof links">
            <a href={`${RITUAL_TESTNET.explorerUrl}/address/${RITUAL_TESTNET.covenantKernel}`} target="_blank" rel="noreferrer">
              Kernel <ExternalLink size={14} />
            </a>
            {finalTx && (
              <a href={`${RITUAL_TESTNET.explorerUrl}/tx/${finalTx.hash}`} target="_blank" rel="noreferrer">
                Final tx <ExternalLink size={14} />
              </a>
            )}
            <a href={receiptDownload} download="covenant-black-box-receipt.json">
              Export JSON <Download size={14} />
            </a>
          </div>
        </article>

        <aside className="blackbox-recorder">
          <div className="recorder-head">
            <TerminalSquare size={18} />
            <div>
              <span>{RITUAL_TESTNET.chainName}</span>
              <strong>{liveStatus === "live" ? "live recorder" : liveStatus}</strong>
            </div>
          </div>
          <div className="recorder-grid">
            {recorderRows.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <code>{shortHash(receiptHash, 18, 16)}</code>
        </aside>
      </section>

      <section className="blackbox-lab">
        <div className="blackbox-layers" role="group" aria-label="Black Box evidence layers">
          {blackBoxLayers.map(({ id, label, icon: Icon }) => (
            <button className={activeLayer === id ? "active" : ""} key={id} onClick={() => setActiveLayer(id)} type="button">
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <article className="blackbox-focus">
          <span>{activeLayerMeta.proof}</span>
          <h2>{activeLayerMeta.title}</h2>
          <p>{activeLayerMeta.text}</p>
          <div className="blackbox-proof-line">
            <strong>{liveState ? `check #${liveState.checkId}` : liveStatus}</strong>
            <code>
              {activeLayer === "intent" && liveState ? shortHash(liveState.intent.intentHash, 14, 12) : null}
              {activeLayer === "policy" && liveState ? shortHash(liveState.receipt.policyHash, 14, 12) : null}
              {activeLayer === "decision" && liveState ? shortHash(liveState.receipt.receiptHash, 14, 12) : null}
              {activeLayer === "remedy" && liveState ? (liveState.intent.executed ? "execution verified" : "receipt only") : null}
              {!liveState ? shortHash(receiptHash, 14, 12) : null}
            </code>
          </div>
        </article>

        <div className="blackbox-trail" aria-label="Investigation trail">
          {investigationTrail.map(([step, title, detail]) => (
            <div className="blackbox-trail-step" key={step}>
              <span>{step}</span>
              <div>
                <strong>{title}</strong>
                <p>{detail}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="blackbox-schema">
        <div>
          <span>Receipt schema</span>
          <h2>Readable by humans. Structured enough for agents.</h2>
          <p>
            The point is not a nicer dashboard. The point is a portable record another agent, judge, or operator
            can replay without trusting a screenshot.
          </p>
        </div>
        <div className="schema-grid">
          {blackBoxSchema.map(([field, detail]) => (
            <article key={field}>
              <code>{field}</code>
              <p>{detail}</p>
            </article>
          ))}
        </div>
      </section>
    </PageShell>
  );
}

function AgentsPage({ liveState, liveStatus, liveError }: { liveState: LiveCovenantState | null; liveStatus: LiveStatus; liveError: string | null }) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { data: nextAgentId } = useReadContract({
    address: RITUAL_TESTNET.covenantKernel as Address,
    abi: kernelReadAbi,
    chainId: ritualTestnet.id,
    functionName: "nextAgentId",
    query: {
      refetchInterval: 15_000,
    },
  });
  const { data: nextCheckId } = useReadContract({
    address: RITUAL_TESTNET.covenantKernel as Address,
    abi: kernelReadAbi,
    chainId: ritualTestnet.id,
    functionName: "nextCheckId",
    query: {
      refetchInterval: 15_000,
    },
  });
  const { data: kernelOwner } = useReadContract({
    address: RITUAL_TESTNET.covenantKernel as Address,
    abi: kernelReadAbi,
    chainId: ritualTestnet.id,
    functionName: "owner",
    query: {
      refetchInterval: 30_000,
    },
  });
  const connectedOwner = Boolean(address && liveState?.agent.owner && address.toLowerCase() === liveState.agent.owner.toLowerCase());
  const walletRole = connectedOwner ? "live agent owner" : isConnected ? "observer wallet" : "wallet idle";
  const chainLabel = chainId === ritualTestnet.id ? "Ritual ready" : isConnected ? `wrong chain ${chainId}` : "not connected";
  const liveAgents = liveState
    ? [
        {
          name: `Agent #${liveState.agentId}`,
          role: `Owner ${shortHash(liveState.agent.owner, 8, 6)}`,
          status: liveState.agent.status,
          bond: `${liveState.agent.bond} RITUAL`,
          heartbeat: liveState.agent.heartbeatDeadline,
          execution: liveState.intent.executed ? "Executed" : "Open",
          meter: liveState.intent.executed ? 100 : 55,
        },
        {
          name: "Successor",
          role: shortHash(liveState.agent.successor, 8, 6),
          status: "Registered",
          bond: "inherits after heartbeat",
          heartbeat: liveState.agent.heartbeatDeadline,
          execution: "Standby",
          meter: 68,
        },
      ]
    : [
        {
          name: liveStatus === "error" ? "RPC error" : "Reading chain",
          role: liveError ?? "Fetching agent storage from Ritual RPC.",
          status: liveStatus,
          bond: "pending",
          heartbeat: "pending",
          execution: "pending",
          meter: 0,
        },
      ];

  return (
    <PageShell>
      <section className="wallet-command-panel">
        <div className="wallet-command-copy">
          <span>Wallet lens</span>
          <h2>{walletRole}</h2>
          <p>{isConnected ? `Connected ${shortHash(address ?? "", 8, 6)}. Kernel reads stay pointed at Ritual Chain Testnet.` : "Connect a wallet to compare it against the live registered agent."}</p>
        </div>
        <div className="wallet-read-grid">
          <div>
            <span>Network</span>
            <strong>{chainLabel}</strong>
          </div>
          <div>
            <span>Kernel owner</span>
            <strong>{kernelOwner ? shortHash(kernelOwner, 8, 6) : liveStatus}</strong>
          </div>
          <div>
            <span>Registered agents</span>
            <strong>{nextAgentId ? Math.max(0, Number(nextAgentId) - 1) : liveStatus}</strong>
          </div>
          <div>
            <span>On-chain checks</span>
            <strong>{nextCheckId ? Math.max(0, Number(nextCheckId) - 1) : liveStatus}</strong>
          </div>
        </div>
      </section>

      <section className="agent-command-grid">
        {liveAgents.map((agent) => (
          <article className="agent-passport" key={agent.name}>
            <div className="agent-orb">
              <Fingerprint size={25} />
            </div>
            <div>
              <span className={`status status-${agent.status.toLowerCase()}`}>{agent.status}</span>
              <h3>{agent.name}</h3>
              <p>{agent.role}</p>
            </div>
            <dl>
              <div>
                <dt>Bond</dt>
                <dd>{agent.bond}</dd>
              </div>
              <div>
                <dt>Heartbeat deadline</dt>
                <dd>{agent.heartbeat}</dd>
              </div>
              <div>
                <dt>Execution</dt>
                <dd>{agent.execution}</dd>
              </div>
            </dl>
            <meter min="0" max="100" value={agent.meter} aria-label={`${agent.name} live progress`} />
          </article>
        ))}
      </section>

      <section className="guardian-layer">
        <div className="guardian-copy">
          <span className="eyebrow">
            <RadioTower size={16} />
            Guardian layer
          </span>
          <h2>{GUARDIAN_AGENT.name}</h2>
          <p>{GUARDIAN_AGENT.purpose}</p>
        </div>
        <div className="guardian-metrics">
          <div>
            <span>Live proof</span>
            <strong>agent #{GUARDIAN_LIVE_PROOF.agentId} / check #{GUARDIAN_LIVE_PROOF.checkId}</strong>
          </div>
          <div>
            <span>Address</span>
            <strong>{shortHash(GUARDIAN_AGENT.address, 8, 6)}</strong>
          </div>
          <div>
            <span>Executed value</span>
            <strong>{GUARDIAN_LIVE_PROOF.executionValue} RITUAL</strong>
          </div>
          <div>
            <span>Bond remaining</span>
            <strong>{GUARDIAN_LIVE_PROOF.bondRemaining} RITUAL</strong>
          </div>
        </div>
      </section>

      <section className="surface-panel">
        <div className="section-head">
          <span>Fleet Telemetry</span>
          <strong>{liveStatus === "live" ? `block ${liveState?.latestBlock}` : liveStatus}</strong>
        </div>
        <div className="agent-table">
          <div className="agent-header">
            <span>Agent</span>
            <span>Status</span>
            <span>Bond</span>
            <span>Heartbeat</span>
            <span>Execution</span>
          </div>
          {liveAgents.map((agent) => (
            <div className="agent-row" key={agent.name}>
              <div>
                <strong>{agent.name}</strong>
                <em>{agent.role}</em>
              </div>
              <span className={`status status-${agent.status.toLowerCase()}`}>{agent.status}</span>
              <span>{agent.bond}</span>
              <span>{agent.heartbeat}</span>
              <span>{agent.execution}</span>
            </div>
          ))}
        </div>
      </section>
    </PageShell>
  );
}

function PolicyStudioPage() {
  const [spend, setSpend] = useState(12);
  const [heartbeat, setHeartbeat] = useState(4);
  const [secretLock, setSecretLock] = useState(true);
  const [severity, setSeverity] = useState("balanced");
  const [testSpend, setTestSpend] = useState(9);
  const [testTargetAllowed, setTestTargetAllowed] = useState(true);
  const [testSecretAccess, setTestSecretAccess] = useState(false);
  const [testMissedHeartbeats, setTestMissedHeartbeats] = useState(0);

  const policyDraft = useMemo(
    () => ({
      version: "covenant.policy.v1",
      spendCapPercent: spend,
      heartbeatFailureWindow: heartbeat,
      secretRekeyRequired: secretLock,
      severity,
      cooldownWindows: severity === "strict" ? 5 : severity === "quiet" ? 1 : 3,
      kernel: RITUAL_TESTNET.covenantKernel,
    }),
    [heartbeat, secretLock, severity, spend],
  );
  const policyHash = useMemo(() => digestPayload(policyDraft), [policyDraft]);
  const policyCid = `ipfs://covenant/policy/${severity}-${policyHash.slice(2, 10)}`;
  const policyJson = useMemo(() => JSON.stringify({ ...policyDraft, policyCid, policyHash }, null, 2), [policyCid, policyDraft, policyHash]);
  const testDecision = assessIntent({
    spendCap: spend,
    intentSpend: testSpend,
    secretLock,
    touchesSecret: testSecretAccess,
    missedHeartbeats: testMissedHeartbeats,
    heartbeatLimit: heartbeat,
    targetAllowed: testTargetAllowed,
    severity,
  });
  const policyDownload = `data:application/json;charset=utf-8,${encodeURIComponent(policyJson)}`;

  return (
    <PageShell>
      <section className="studio-layout">
        <div className="surface-panel studio-controls">
          <div className="section-head">
            <span>Policy Controls</span>
            <strong>Policy v1</strong>
          </div>
          <label className="control-row">
            <span>Treasury spend cap</span>
            <strong>{spend}%</strong>
            <input type="range" min="2" max="30" value={spend} onChange={(event) => setSpend(Number(event.target.value))} />
          </label>
          <label className="control-row">
            <span>Heartbeat failure window</span>
            <strong>{heartbeat} epochs</strong>
            <input type="range" min="2" max="8" value={heartbeat} onChange={(event) => setHeartbeat(Number(event.target.value))} />
          </label>
          <label className="toggle-row">
            <span>
              <KeyRound size={17} />
              Secret re-key required
            </span>
            <input type="checkbox" checked={secretLock} onChange={(event) => setSecretLock(event.target.checked)} />
          </label>
          <div className="segmented" role="group" aria-label="Policy severity">
            {["quiet", "balanced", "strict"].map((item) => (
              <button key={item} className={severity === item ? "active" : ""} onClick={() => setSeverity(item)}>
                {item}
              </button>
            ))}
          </div>
        </div>

        <div className="policy-preview">
          <div className="policy-paper">
            <span>Signed Policy CID</span>
            <h2>{policyCid}</h2>
            <p>No spend above {spend}% of treasury in one action.</p>
            <p>Trigger inheritance after {heartbeat} missed heartbeat epochs.</p>
            <p>{secretLock ? "Secrets require DKMS re-key before successor activation." : "Successor receives public memory CID only."}</p>
            <p>Slashed agents enter a three-window cooldown.</p>
            <div className="hash-strip">
              <span>policyHash</span>
              <code>{policyHash}</code>
            </div>
            <a className="receipt-download inline-download" href={policyDownload} download="ritual-covenant-policy.json">
              <Download size={15} />
              Export policy JSON
            </a>
          </div>
          <div className={`policy-live-test ${classForKind(testDecision.kind)}`}>
            <div className="simulator-head">
              <div>
                <span>Intent test</span>
                <h3>{testDecision.label} / {testDecision.confidence}%</h3>
              </div>
              <DecisionBadge kind={testDecision.kind} />
            </div>
            <div className="simulator-controls">
              <label className="control-row compact-control">
                <span>Intent value</span>
                <strong>{testSpend}%</strong>
                <input type="range" min="0" max="42" value={testSpend} onChange={(event) => setTestSpend(Number(event.target.value))} />
              </label>
              <label className="toggle-row compact-toggle">
                <span>
                  <ShieldCheck size={16} />
                  Target allowlisted
                </span>
                <input type="checkbox" checked={testTargetAllowed} onChange={(event) => setTestTargetAllowed(event.target.checked)} />
              </label>
              <label className="toggle-row compact-toggle">
                <span>
                  <KeyRound size={16} />
                  Secret access
                </span>
                <input type="checkbox" checked={testSecretAccess} onChange={(event) => setTestSecretAccess(event.target.checked)} />
              </label>
              <label className="control-row compact-control">
                <span>Heartbeat misses</span>
                <strong>{testMissedHeartbeats}</strong>
                <input type="range" min="0" max="7" value={testMissedHeartbeats} onChange={(event) => setTestMissedHeartbeats(Number(event.target.value))} />
              </label>
            </div>
            <p>{testDecision.reason}</p>
          </div>
          <div className="policy-json-console">
            <div className="terminal-head">
              <FileCode2 size={17} />
              <span>Policy artifact</span>
              <strong>{shortHash(policyHash, 8, 6)}</strong>
            </div>
            <pre>{policyJson}</pre>
          </div>
          <div className="clause-grid">
            {clauses.map((clause, index) => (
              <div className="clause-row" key={clause}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <p>{clause}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </PageShell>
  );
}

function InheritancePage({ liveState, liveStatus }: { liveState: LiveCovenantState | null; liveStatus: LiveStatus }) {
  const [plannerMisses, setPlannerMisses] = useState(3);
  const [plannerReserve, setPlannerReserve] = useState(18);
  const [plannerRekey, setPlannerRekey] = useState(true);
  const recoveryOpen = plannerMisses >= 4;
  const recoveryKind: CaseKind = recoveryOpen ? "revived" : plannerMisses >= 3 ? "blocked" : "allowed";
  const recoveryHash = useMemo(
    () =>
      digestPayload({
        agent: liveState?.agentId ?? "offline",
        misses: plannerMisses,
        reserve: plannerReserve,
        rekey: plannerRekey,
        successor: liveState?.agent.successor ?? "pending",
      }),
    [liveState?.agent.successor, liveState?.agentId, plannerMisses, plannerRekey, plannerReserve],
  );
  const plannerSteps = [
    ["Heartbeat", recoveryOpen ? "failure threshold reached" : `${4 - plannerMisses} epochs remaining`],
    ["Spend state", plannerMisses >= 3 ? "new risky intents frozen" : "active"],
    ["Secret path", plannerRekey ? "successor re-key queued" : "memory CID only"],
    ["Reserve", `${plannerReserve}% bond protected`],
  ];
  const liveInheritanceSteps = liveState
    ? [
        {
          label: "Agent registered",
          detail: `Owner ${shortHash(liveState.agent.owner, 8, 6)} controls agent #${liveState.agentId}.`,
          icon: BadgeCheck,
          state: liveState.agent.status,
        },
        {
          label: "Successor stored",
          detail: `Successor address ${shortHash(liveState.agent.successor, 8, 6)} is anchored in kernel storage.`,
          icon: Workflow,
          state: "registered",
        },
        {
          label: "Heartbeat clock",
          detail: `Last heartbeat ${liveState.agent.lastHeartbeat}; deadline ${liveState.agent.heartbeatDeadline}.`,
          icon: HeartPulse,
          state: "tracked",
        },
        {
          label: "Will execution",
          detail: liveState.agent.status === "Inherited" ? "Inheritance receipt is stored on-chain." : "Not triggered on-chain; agent is still active.",
          icon: Vault,
          state: liveState.agent.status === "Inherited" ? "inherited" : "standby",
        },
      ]
    : inheritanceSteps.map((step) => ({ ...step, detail: `Waiting for Ritual RPC: ${liveStatus}.` }));

  return (
    <PageShell>
      <section className="inheritance-layout">
        <div className="surface-panel">
          <div className="section-head">
            <span>Recovery Run</span>
            <strong>{liveState ? `Agent #${liveState.agentId} to successor` : liveStatus}</strong>
          </div>
          <div className="timeline">
            {liveInheritanceSteps.map(({ label, detail, icon: Icon, state }) => (
              <div className="timeline-item" key={label}>
                <div className="timeline-icon">
                  <Icon size={20} />
                </div>
                <div>
                  <span>{state}</span>
                  <h3>{label}</h3>
                  <p>{detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="inheritance-card">
          <span>Successor Policy</span>
          <h2>{liveState ? (liveState.agent.status === "Inherited" ? "Successor activated" : "Successor standby") : "Reading chain"}</h2>
          <dl>
            <div>
              <dt>Policy CID</dt>
              <dd>{liveState ? liveState.agent.policyCid : "pending"}</dd>
            </div>
            <div>
              <dt>Remaining bond</dt>
              <dd>{liveState ? `${liveState.agent.bond} RITUAL` : "pending"}</dd>
            </div>
            <div>
              <dt>Cooldown</dt>
              <dd>{liveState ? liveState.agent.cooldownUntil : "pending"}</dd>
            </div>
            <div>
              <dt>Authority</dt>
              <dd>{liveState ? liveState.agent.status : liveStatus}</dd>
            </div>
          </dl>
        </div>
      </section>
      <section className={`recovery-planner ${classForKind(recoveryKind)}`}>
        <div className="planner-copy">
          <span>Recovery planner</span>
          <h2>{recoveryOpen ? "Successor path opens." : "Agent remains active."}</h2>
          <p>{recoveryOpen ? "Heartbeat failure is high enough to move the agent into inheritance handling." : "Policy keeps watching heartbeat and blocks early recovery."}</p>
        </div>
        <div className="planner-controls">
          <label className="control-row compact-control">
            <span>Missed heartbeat epochs</span>
            <strong>{plannerMisses}</strong>
            <input type="range" min="0" max="8" value={plannerMisses} onChange={(event) => setPlannerMisses(Number(event.target.value))} />
          </label>
          <label className="control-row compact-control">
            <span>Bond reserve</span>
            <strong>{plannerReserve}%</strong>
            <input type="range" min="0" max="40" value={plannerReserve} onChange={(event) => setPlannerReserve(Number(event.target.value))} />
          </label>
          <label className="toggle-row compact-toggle">
            <span>
              <KeyRound size={16} />
              Re-key secrets
            </span>
            <input type="checkbox" checked={plannerRekey} onChange={(event) => setPlannerRekey(event.target.checked)} />
          </label>
        </div>
        <div className="planner-steps">
          {plannerSteps.map(([label, value], index) => (
            <div key={label}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{label}</strong>
              <em>{value}</em>
            </div>
          ))}
        </div>
        <div className="hash-strip planner-hash">
          <span>recovery receipt</span>
          <code>{recoveryHash}</code>
        </div>
      </section>
    </PageShell>
  );
}

function LiveContractProof({ liveState, liveStatus, liveError }: { liveState: LiveCovenantState | null; liveStatus: LiveStatus; liveError: string | null }) {
  const rows = liveState
    ? [
        ["chainId", liveState.chainId],
        ["kernel", liveState.kernelAddress],
        ["codeBytes", String(liveState.codeBytes)],
        ["owner", liveState.owner],
        ["ownerIsAttestor", liveState.ownerIsAttestor ? "true" : "false"],
        ["agentOwner", liveState.agent.owner],
        ["successor", liveState.agent.successor],
        ["policyCid", liveState.agent.policyCid],
        ["receiptHash", liveState.receipt.receiptHash],
        ["latestBlockTime", liveState.latestBlockTime],
      ]
    : [
        ["chainId", String(RITUAL_TESTNET.chainId)],
        ["kernel", RITUAL_TESTNET.covenantKernel],
        ["status", liveStatus],
        ["message", liveError ?? "Fetching contract state from Ritual RPC."],
      ];

  return (
    <section className={`offline-kit ${classForKind(liveStatus === "error" ? "blocked" : "allowed")}`}>
      <div className="offline-head">
        <div>
          <span>Live contract state</span>
          <h3>Ritual on-chain proof</h3>
        </div>
        <strong>{liveStatus === "live" ? "read from rpc" : liveStatus}</strong>
      </div>

      <div className="offline-body">
        <div className="offline-controls">
          <a className="trial-button active" href={`${RITUAL_TESTNET.explorerUrl}/address/${RITUAL_TESTNET.covenantKernel}`} target="_blank" rel="noreferrer">
            <TerminalSquare size={17} />
            <span>Kernel explorer</span>
          </a>
          {liveState && (
            <a className="trial-button" href={`${RITUAL_TESTNET.explorerUrl}/address/${liveState.sinkAddress}`} target="_blank" rel="noreferrer">
              <Vault size={17} />
              <span>Sink explorer</span>
            </a>
          )}
          <div className="offline-slider">
            <span>
              <CircleDollarSign size={16} />
              Kernel balance
            </span>
            <strong>{liveState ? `${liveState.kernelBalance} RITUAL` : liveStatus}</strong>
          </div>
          <div className="offline-slider">
            <span>
              <ShieldCheck size={16} />
              Executed intent
            </span>
            <strong>{liveState ? (liveState.intent.executed ? "true" : "false") : liveStatus}</strong>
          </div>
          <div className="offline-slider">
            <span>
              <ScrollText size={16} />
              Decision
            </span>
            <strong>{liveState ? liveState.receipt.decision : liveStatus}</strong>
          </div>
        </div>

        <div className="offline-receipt">
          <div className="offline-verdict">
            <BadgeCheck size={23} />
            <div>
              <span>Public proof</span>
              <h3>{liveState ? "ON-CHAIN" : liveStatus.toUpperCase()}</h3>
            </div>
          </div>

          <p>{liveState ? `Check #${liveState.checkId} executed against target ${shortHash(liveState.intent.target, 8, 6)} and moved ${liveState.intent.value} RITUAL to the live sink.` : liveError ?? "Waiting for verified Ritual RPC data."}</p>

          <div className="offline-code">
            <span>contract read path</span>
            <code>agents(1) + intents(1) + receipts(1) + tx receipts + RitualValueSink.received()</code>
          </div>

          <div className="receipt-grid compact-receipt">
            {rows.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ContractsPage({ liveState, liveStatus, liveError }: { liveState: LiveCovenantState | null; liveStatus: LiveStatus; liveError: string | null }) {
  const { address, isConnected } = useAccount();
  const [playgroundTarget, setPlaygroundTarget] = useState<"kernel" | "guardian" | "bounty">("kernel");
  const [playgroundMethod, setPlaygroundMethod] = useState(0);
  const [playgroundValues, setPlaygroundValues] = useState<Record<string, string>>({});
  const playgroundGroups = {
    kernel: { label: "CovenantKernel", address: RITUAL_TESTNET.covenantKernel, methods: contractMethods },
    guardian: { label: "GuardianAgent", address: GUARDIAN_AGENT.address, methods: guardianMethods },
    bounty: { label: "BountyJudge", address: BOUNTY_JUDGE.address, methods: bountyJudgeMethods },
  };
  const activeGroup = playgroundGroups[playgroundTarget];
  const activeMethod = activeGroup.methods[bound(playgroundMethod, 0, activeGroup.methods.length - 1)];
  const paramValues = activeMethod.params.map((param) => playgroundValues[`${playgroundTarget}:${activeMethod.name}:${param}`] ?? "");
  const methodSignature = `${activeMethod.name}(${activeMethod.params.map((param) => param.split(" ")[0]).join(",")})`;
  const calldataPreview = useMemo(
    () =>
      digestPayload({
        contract: activeGroup.address,
        method: activeMethod.name,
        params: paramValues,
        caller: address ?? "not-connected",
      }),
    [activeGroup.address, activeMethod.name, address, paramValues],
  );

  return (
    <PageShell>
      <LiveContractProof liveState={liveState} liveStatus={liveStatus} liveError={liveError} />
      <section className="abi-playground">
        <div className="abi-copy">
          <span>ABI playground</span>
          <h2>{activeGroup.label}</h2>
          <p>{isConnected ? `Caller ${shortHash(address ?? "", 8, 6)} is ready for wallet-backed testing.` : "Read the ABI surface and prepare calls before connecting a wallet."}</p>
        </div>
        <div className="abi-controls">
          <div className="segmented compact-segmented" role="group" aria-label="Contract target">
            {(["kernel", "guardian", "bounty"] as const).map((target) => (
              <button
                key={target}
                className={playgroundTarget === target ? "active" : ""}
                onClick={() => {
                  setPlaygroundTarget(target);
                  setPlaygroundMethod(0);
                }}
              >
                {playgroundGroups[target].label}
              </button>
            ))}
          </div>
          <label className="form-field abi-select">
            <span>Method</span>
            <select value={playgroundMethod} onChange={(event) => setPlaygroundMethod(Number(event.target.value))}>
              {activeGroup.methods.map((method, index) => (
                <option value={index} key={method.name}>
                  {method.name}
                </option>
              ))}
            </select>
          </label>
          <div className="abi-param-editor">
            {activeMethod.params.length > 0 ? (
              activeMethod.params.map((param) => {
                const key = `${playgroundTarget}:${activeMethod.name}:${param}`;
                return (
                  <label className="form-field" key={param}>
                    <span>{param}</span>
                    <input value={playgroundValues[key] ?? ""} onChange={(event) => setPlaygroundValues((current) => ({ ...current, [key]: event.target.value }))} />
                  </label>
                );
              })
            ) : (
              <div className="empty-param">No parameters.</div>
            )}
          </div>
        </div>
        <div className="abi-output">
          <div className="offline-code">
            <span>target</span>
            <code>{activeGroup.address}</code>
          </div>
          <div className="offline-code">
            <span>signature</span>
            <code>{methodSignature}</code>
          </div>
          <div className="offline-code">
            <span>prepared hash</span>
            <code>{calldataPreview}</code>
          </div>
          <a className="receipt-download inline-download" href={`${RITUAL_TESTNET.explorerUrl}/address/${activeGroup.address}`} target="_blank" rel="noreferrer">
            <ExternalLink size={15} />
            Open contract
          </a>
        </div>
      </section>
      <section className="guardian-contract-panel">
        <div className="guardian-contract-head">
          <div>
            <span>New companion contract</span>
            <h3>{GUARDIAN_AGENT.name}</h3>
          </div>
          <strong>{GUARDIAN_AGENT.status}</strong>
        </div>
        <p>{GUARDIAN_AGENT.purpose}</p>
        <div className="guardian-contract-grid">
          {guardianRows.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        <div className="guardian-command-row">
          <a href={`${RITUAL_TESTNET.explorerUrl}/address/${GUARDIAN_AGENT.address}`} target="_blank" rel="noreferrer">
            Guardian explorer <ExternalLink size={14} />
          </a>
          <a href={`${RITUAL_TESTNET.explorerUrl}/tx/${GUARDIAN_AGENT.deploymentTx}`} target="_blank" rel="noreferrer">
            Deploy tx <ExternalLink size={14} />
          </a>
          <a href={`${RITUAL_TESTNET.explorerUrl}/tx/${GUARDIAN_LIVE_PROOF.latestTx}`} target="_blank" rel="noreferrer">
            Live flow tx <ExternalLink size={14} />
          </a>
          <code>{GUARDIAN_AGENT.dryRunCommand}</code>
          <code>{GUARDIAN_AGENT.deployScript}</code>
        </div>
      </section>
      <section className="guardian-contract-panel">
        <div className="guardian-contract-head">
          <div>
            <span>Sovereign agent path</span>
            <h3>{COVENANT_SENTINEL.name}</h3>
          </div>
          <strong>{COVENANT_SENTINEL.status}</strong>
        </div>
        <p>{COVENANT_SENTINEL.purpose}</p>
        <div className="guardian-contract-grid">
          {sentinelRows.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        <div className="guardian-command-row">
          <a href={`${RITUAL_TESTNET.explorerUrl}/address/${COVENANT_SENTINEL.address}`} target="_blank" rel="noreferrer">
            Sentinel explorer <ExternalLink size={14} />
          </a>
          <a href={`${RITUAL_TESTNET.explorerUrl}/address/${COVENANT_SENTINEL.harnessAddress}`} target="_blank" rel="noreferrer">
            Harness explorer <ExternalLink size={14} />
          </a>
          <a href={`${RITUAL_TESTNET.explorerUrl}/tx/${COVENANT_SENTINEL.harnessDeployTx}`} target="_blank" rel="noreferrer">
            Harness tx <ExternalLink size={14} />
          </a>
          <code>{COVENANT_SENTINEL.deployCommand}</code>
          <code>{COVENANT_SENTINEL.harnessCommand}</code>
        </div>
      </section>
      <section className="contract-layout">
        <div className="contract-list">
          {contractModules.map(({ name, icon: Icon, purpose }) => (
            <article key={name} className="contract-module">
              <Icon size={21} />
              <div>
                <h3>{name}</h3>
                <p>{purpose}</p>
              </div>
            </article>
          ))}
          <div className="deploy-route">
            <div className="deploy-route-head">
              <FileCode2 size={18} />
              <div>
                <span>Testnet handoff</span>
                <h3>Deployment sequence</h3>
              </div>
            </div>
            <div className="deploy-route-steps">
              {deployRoute.map((item, index) => (
                <div className="deploy-route-step" key={item.label}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{item.label}</strong>
                    <p>{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="terminal-panel contract-console">
          <div className="terminal-head">
            <TerminalSquare size={17} />
            <span>{RITUAL_TESTNET.chainName}</span>
            <strong>{RITUAL_TESTNET.status}</strong>
          </div>
          <div className="method-stack" aria-label="Contract ABI methods">
            {contractMethods.map((method, index) => (
              <article className="method-card" key={method.name}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <div className="method-title-row">
                    <code>{method.name}</code>
                    <strong>external</strong>
                  </div>
                  <div className="param-list">
                    {method.params.map((param) => (
                      <em key={param}>{param}</em>
                    ))}
                  </div>
                  <p>{method.purpose}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="terminal-panel guardian-console">
        <div className="terminal-head">
          <RadioTower size={17} />
          <span>Guardian ABI</span>
          <strong>agent companion</strong>
        </div>
        <div className="method-stack guardian-methods" aria-label="Guardian contract methods">
          {guardianMethods.map((method, index) => (
            <article className="method-card" key={method.name}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <div className="method-title-row">
                  <code>{method.name}</code>
                  <strong>external</strong>
                </div>
                <div className="param-list">
                  {method.params.length > 0 ? method.params.map((param) => <em key={param}>{param}</em>) : <em>no params</em>}
                </div>
                <p>{method.purpose}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
      <div className="checklist">
        {contractIntegrationChecklist.map((item) => (
          <p key={item}>
            <ArrowRight size={15} />
            {item}
          </p>
        ))}
      </div>
    </PageShell>
  );
}

function BriefPage({
  liveState,
  liveStatus,
  go,
}: {
  liveState: LiveCovenantState | null;
  liveStatus: LiveStatus;
  go: (page: PageId) => void;
}) {
  return (
    <PageShell>
      <section className="brief-layout">
        <article className="brief-article">
          <span className="eyebrow">
            <ScrollText size={16} />
            Builder brief
          </span>
          <h1>Ritual Covenant makes autonomous agents enforceable before they act.</h1>
          <p className="brief-lede">
            Covenant is a live on-chain control surface for agents that move value, depend on private memory,
            and need a recovery path when their operator, scheduler, or wallet fails.
          </p>
          <div className="brief-meta" aria-label="Project proof links">
            <a href={`${RITUAL_TESTNET.explorerUrl}/address/${RITUAL_TESTNET.covenantKernel}`} target="_blank" rel="noreferrer">
              Contract <ExternalLink size={14} />
            </a>
            <button onClick={() => go("contracts")}>
              Live proof <ArrowRight size={14} />
            </button>
            <a href={builderXUrl} target="_blank" rel="noreferrer">
              ASPRO_22 <ExternalLink size={14} />
            </a>
          </div>
        </article>

        <aside className="brief-author">
          <img src={ritualAssets.logo} alt="" />
          <span>Builder channel</span>
          <h3>ASPRO_22</h3>
          <p>Build notes, proof updates, and the public Ritual Covenant submission trail.</p>
          <a href={builderXUrl} target="_blank" rel="noreferrer">
            Open X profile <ExternalLink size={15} />
          </a>
        </aside>
      </section>

      <section className="brief-columns" aria-label="Project explanation">
        {briefSections.map((section, index) => (
          <article className="brief-note" key={section.title}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <h3>{section.title}</h3>
            <p>{section.body}</p>
          </article>
        ))}
      </section>

      <section className="brief-proof">
        <div>
          <span>How Covenant works</span>
          <h2>Policy becomes an execution path, not a dashboard warning.</h2>
        </div>
        <div className="brief-flow">
          {briefFlow.map((item, index) => (
            <div className="brief-flow-step" key={item}>
              <strong>{String(index + 1).padStart(2, "0")}</strong>
              <p>{item}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="brief-proof live">
        <div>
          <span>Current on-chain proof</span>
          <h2>{liveState ? `Agent #${liveState.agentId} executed check #${liveState.checkId}.` : `Ritual RPC: ${liveStatus}`}</h2>
          <p>
            {liveState
              ? `The live sink received ${liveState.sink.received} RITUAL and the CovenantKernel proof is readable from block ${liveState.latestBlock}.`
              : "The frontend reads CovenantKernel directly from Ritual Chain Testnet."}
          </p>
        </div>
        <a className="brief-proof-link" href={`${RITUAL_TESTNET.explorerUrl}/address/${RITUAL_TESTNET.covenantKernel}`} target="_blank" rel="noreferrer">
          Inspect kernel <ExternalLink size={16} />
        </a>
      </section>
    </PageShell>
  );
}

function BountyProofLab() {
  const [mode, setMode] = useState<"public" | "covenant">("covenant");
  const [activeStep, setActiveStep] = useState(1);
  const protectedMode = mode === "covenant";
  const activeReplay = bountyReplaySteps[activeStep];
  const originalCommit = digestPayload({
    answer: "Original privacy-preserving bounty design",
    salt: "0xritual-builder-salt",
    participant: "0xA17C...B011D",
    bountyId: 1,
  });
  const copycatCommit = digestPayload({
    answer: "Original privacy-preserving bounty design",
    salt: "0xritual-builder-salt",
    participant: protectedMode ? "0xC0PY...CA7" : "0xA17C...B011D",
    bountyId: 1,
  });
  const batchReceipt = digestPayload({
    prompt: "Judge originality, security, and Ritual-native design.",
    eligibleSubmissionIds: protectedMode ? [1] : [1, 2],
    result: protectedMode ? "clean batch" : "contaminated batch",
  });

  return (
    <section className={`bounty-proof-lab ${protectedMode ? "protected" : "leaky"}`} aria-label="Commit reveal attack replay">
      <div className="proof-lab-head">
        <div>
          <span>Attack replay</span>
          <h2>{protectedMode ? "The copycat can see the chain, not the answer." : "Public submissions turn originality into a race."}</h2>
          <p>
            {protectedMode
              ? "Covenant binds each reveal to the exact answer, salt, sender wallet, and bounty ID before AI judging starts."
              : "Without commit-reveal, the best answer becomes public training data for late submissions."}
          </p>
        </div>
        <div className="proof-mode-toggle" role="group" aria-label="Bounty replay mode">
          <button className={!protectedMode ? "active" : ""} onClick={() => setMode("public")} type="button">
            Public leak
          </button>
          <button className={protectedMode ? "active" : ""} onClick={() => setMode("covenant")} type="button">
            Covenant gate
          </button>
        </div>
      </div>

      <div className="proof-lab-grid">
        <div className="replay-timeline" aria-label="Replay timeline">
          {bountyReplaySteps.map((step, index) => (
            <button className={activeStep === index ? "active" : ""} key={step.label} onClick={() => setActiveStep(index)} type="button">
              <strong>{String(index + 1).padStart(2, "0")}</strong>
              <span>{step.label}</span>
            </button>
          ))}
        </div>

        <article className="replay-verdict">
          <span>{protectedMode ? "protected path" : "unsafe path"}</span>
          <h3>{activeReplay.label}</h3>
          <p>{protectedMode ? activeReplay.covenant : activeReplay.public}</p>
          <div className="verdict-meter">
            <div>
              <span>Original commit</span>
              <code>{shortHash(originalCommit, 12, 10)}</code>
            </div>
            <div>
              <span>Copycat reveal</span>
              <code>{protectedMode ? "rejected: sender mismatch" : shortHash(copycatCommit, 12, 10)}</code>
            </div>
            <div>
              <span>Judge batch</span>
              <code>{shortHash(batchReceipt, 12, 10)}</code>
            </div>
          </div>
        </article>

        <aside className="tee-note">
          <span>Advanced Ritual-native route</span>
          <h3>Encrypted first, plaintext only inside the judge.</h3>
          <p>
            Commit-reveal satisfies the required EVM track. The stronger Ritual path keeps ciphertext CIDs and hashes on-chain, decrypts the eligible batch inside a TEE-backed judge, and anchors only the batch receipt and winner.
          </p>
        </aside>
      </div>

      <div className="receipt-rail" aria-label="Bounty event receipt rail">
        {bountyReceiptSteps.map((item, index) => (
          <article key={item.event}>
            <strong>{String(index + 1).padStart(2, "0")}</strong>
            <div>
              <span>{item.event}</span>
              <p>{item.check}</p>
              <code>{item.proof}</code>
            </div>
          </article>
        ))}
      </div>

      <div className="sdk-panel">
        <div>
          <span>Developer kit</span>
          <h3>Not just a demo: reusable bounty primitives.</h3>
          <p>These helpers make the contract easier for another builder to integrate without re-learning the full lifecycle.</p>
        </div>
        <div className="sdk-cards">
          {bountySdkSnippets.map((snippet) => (
            <article key={snippet.name}>
              <code>{snippet.name}</code>
              <p>{snippet.text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function HiddenJudgeRoom() {
  const { address } = useAccount();
  const [bountyId, setBountyId] = useState("1");
  const [answer, setAnswer] = useState("A fair bounty system should hide submissions until the commit window closes.");
  const [salt, setSalt] = useState("ritual-builder-private-salt");
  const [secret, setSecret] = useState("ritual-tee-demo-key");
  const [packet, setPacket] = useState<HiddenJudgePacket | null>(null);
  const [sealStatus, setSealStatus] = useState("Ready to seal locally.");

  const participant = (address ?? BOUNTY_JUDGE.owner) as Address;
  const numericBountyId = Math.max(1, Math.floor(Number(bountyId) || 1));
  const normalizedSalt = useMemo(() => normalizeBytes32(salt), [salt]);
  const promptHash = useMemo(() => keccak256(stringToHex("Ritual Covenant hidden bounty judge rubric v1")), []);

  const exactCommitment = useMemo(
    () =>
      keccak256(
        encodeAbiParameters(
          [
            { name: "answer", type: "string" },
            { name: "salt", type: "bytes32" },
            { name: "participant", type: "address" },
            { name: "bountyId", type: "uint256" },
          ],
          [answer, normalizedSalt, participant, BigInt(numericBountyId)],
        ),
      ),
    [answer, normalizedSalt, numericBountyId, participant],
  );

  const packetHref = useMemo(() => {
    if (!packet) return undefined;
    return `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(packet, null, 2))}`;
  }, [packet]);

  async function sealPacket() {
    if (!answer.trim()) {
      setSealStatus("Write an answer before sealing.");
      return;
    }

    try {
      setSealStatus("Encrypting answer in this browser.");
      const encrypted = await encryptForHiddenJudge(answer.trim(), secret);
      const ciphertextHash = keccak256(stringToHex(`${encrypted.iv}:${encrypted.ciphertext}`));
      const batchInputHash = keccak256(
        encodeAbiParameters(
          [
            { name: "bountyId", type: "uint256" },
            { name: "promptHash", type: "bytes32" },
            { name: "commitment", type: "bytes32" },
            { name: "ciphertextHash", type: "bytes32" },
            { name: "judgeMode", type: "string" },
          ],
          [BigInt(numericBountyId), promptHash, exactCommitment, ciphertextHash, "ritual-tee-batch"],
        ),
      );

      setPacket({
        version: "ritual.hiddenJudge.v1",
        bountyId: numericBountyId,
        participant,
        promptHash,
        commitment: exactCommitment,
        salt: normalizedSalt,
        ciphertextHash,
        batchInputHash,
        encryption: {
          algorithm: "AES-GCM",
          kdf: "PBKDF2-SHA256",
          iv: encrypted.iv,
          ciphertext: encrypted.ciphertext,
        },
        privacyMap: {
          plaintext: "browser before sealing; future Ritual TEE batch judge during scoring",
          onChain: hiddenJudgePublicFields,
          offChain: ["encrypted answer blob", "ciphertext CID", "ciphertextHash"],
          tee: "decrypt eligible answers once, score the full batch, return result hash and winner",
        },
      });
      setSealStatus("Sealed locally. No transaction was sent.");
    } catch (error) {
      setSealStatus(error instanceof Error ? error.message : "Could not seal packet.");
    }
  }

  return (
    <section className="hidden-judge-room" aria-label="Ritual-native hidden judge sealing room">
      <div className="hidden-room-copy">
        <span>
          <Vault size={16} />
          Advanced track kit
        </span>
        <h2>Hidden answers until the judge is ready.</h2>
        <p>
          This local sealing room shows the Ritual-native path: commit on-chain, keep answer ciphertext off-chain,
          decrypt the eligible batch inside a TEE-backed judge, then anchor one result receipt.
        </p>
        <div className="hidden-flow-grid">
          {hiddenJudgeFlow.map((item, index) => (
            <article key={item.title}>
              <strong>{String(index + 1).padStart(2, "0")}</strong>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </div>

      <div className="hidden-seal-panel">
        <div className="terminal-head">
          <LockKeyhole size={17} />
          <span>TEE batch envelope</span>
          <strong>local only</strong>
        </div>
        <div className="hidden-seal-form">
          <label className="form-field">
            <span>Bounty ID</span>
            <input min="1" type="number" value={bountyId} onChange={(event) => setBountyId(event.target.value)} />
          </label>
          <label className="form-field">
            <span>Answer plaintext</span>
            <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} rows={4} />
          </label>
          <div className="dual-inputs">
            <label className="form-field">
              <span>Salt or bytes32</span>
              <input value={salt} onChange={(event) => setSalt(event.target.value)} />
            </label>
            <label className="form-field">
              <span>Local secret</span>
              <input value={secret} onChange={(event) => setSecret(event.target.value)} />
            </label>
          </div>
          <button className="primary-action workbench-button" type="button" onClick={sealPacket}>
            Seal locally
          </button>
        </div>

        <div className="hidden-proof-stack">
          <div>
            <span>Contract commitment</span>
            <code>{shortHash(exactCommitment, 18, 14)}</code>
          </div>
          <div>
            <span>Ciphertext hash</span>
            <code>{packet ? shortHash(packet.ciphertextHash, 18, 14) : "not sealed yet"}</code>
          </div>
          <div>
            <span>Batch input hash</span>
            <code>{packet ? shortHash(packet.batchInputHash, 18, 14) : "not sealed yet"}</code>
          </div>
        </div>

        <div className="privacy-map">
          <article>
            <span>Public</span>
            <p>{hiddenJudgePublicFields.join(", ")}</p>
          </article>
          <article>
            <span>Hidden</span>
            <p>{hiddenJudgePrivateFields.join(", ")}</p>
          </article>
        </div>

        <div className="hidden-export-row">
          <p>{sealStatus}</p>
          <a className={packetHref ? "secondary-action" : "secondary-action disabled"} href={packetHref} download="ritual-hidden-judge-packet.json" aria-disabled={!packetHref}>
            <Download size={16} />
            Export packet
          </a>
        </div>
      </div>
    </section>
  );
}

function BountyJudgePage() {
  return (
    <PageShell>
      <section className="brief-layout bounty-layout">
        <article className="brief-article bounty-hero-panel">
          <span className="eyebrow">
            <LockKeyhole size={16} />
            Privacy-preserving bounty
          </span>
          <h1>Commit-Reveal Bounty Judge</h1>
          <p className="brief-lede">
            Builders commit hidden answers first, reveal only after the deadline, and send one verified batch
            into AI judging.
          </p>
          <div className="brief-meta" aria-label="Bounty judge contract links">
            <a href={`${RITUAL_TESTNET.explorerUrl}/address/${BOUNTY_JUDGE.address}`} target="_blank" rel="noreferrer">
              Live contract <ExternalLink size={14} />
            </a>
            <a href={`${RITUAL_TESTNET.explorerUrl}/tx/${BOUNTY_JUDGE.deploymentTx}`} target="_blank" rel="noreferrer">
              Deploy tx <ExternalLink size={14} />
            </a>
            <a href="https://github.com/aspro45/Ritual_Covenant/blob/main/contracts/CommitRevealBountyJudge.sol" target="_blank" rel="noreferrer">
              Solidity <ExternalLink size={14} />
            </a>
            <a href="https://github.com/aspro45/Ritual_Covenant/blob/main/scripts/bounty-tests.cjs" target="_blank" rel="noreferrer">
              Tests <ExternalLink size={14} />
            </a>
          </div>
        </article>

        <aside className="bounty-contract-card">
          <div className="bounty-card-mark">
            <img src={ritualAssets.logo} alt="" />
            <span>{BOUNTY_JUDGE.status}</span>
          </div>
          <h3>Commit-Reveal Judge</h3>
          <p>{BOUNTY_JUDGE.purpose}</p>
          <dl className="bounty-proof-list">
            <div>
              <dt>Contract</dt>
              <dd>{shortHash(BOUNTY_JUDGE.address, 10, 8)}</dd>
            </div>
            <div>
              <dt>Deploy tx</dt>
              <dd>{shortHash(BOUNTY_JUDGE.deploymentTx, 10, 8)}</dd>
            </div>
            <div>
              <dt>Gas</dt>
              <dd>{BOUNTY_JUDGE.deploymentGasUsed}</dd>
            </div>
          </dl>
        </aside>
      </section>

      <section className="bounty-visual-proof">
        <img src={ritualAssets.bountyFlow} alt="" />
        <div className="bounty-visual-copy">
          <span>Lifecycle</span>
          <h2>Commit first. Reveal later. Judge once.</h2>
          <p>Only valid revealed answers enter the AI batch, so public copying during the submission window stops being useful.</p>
        </div>
        <div className="brief-flow">
          {bountyFlow.map((item, index) => (
            <div className="brief-flow-step" key={item}>
              <strong>{String(index + 1).padStart(2, "0")}</strong>
              <p>{item}</p>
            </div>
          ))}
        </div>
      </section>

      <BountyProofLab />

      <HiddenJudgeRoom />

      <BountyWorkbench />

      <section className="primitive-grid compact">
        {bountyArchitecture.map(({ name, icon: Icon, text }) => (
          <article className="primitive-item" key={name}>
            <Icon size={22} />
            <h3>{name}</h3>
            <p>{text}</p>
            <strong>Assignment-ready</strong>
          </article>
        ))}
      </section>

      <section className="terminal-panel guardian-console">
        <div className="terminal-head">
          <TerminalSquare size={17} />
          <span>Bounty ABI</span>
          <strong>commit-reveal</strong>
        </div>
        <div className="method-stack guardian-methods" aria-label="Bounty judge methods">
          {bountyJudgeMethods.map((method, index) => (
            <article className="method-card" key={method.name}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <div className="method-title-row">
                  <code>{method.name}</code>
                  <strong>external</strong>
                </div>
                <div className="param-list">
                  {method.params.map((param) => (
                    <em key={param}>{param}</em>
                  ))}
                </div>
                <p>{method.purpose}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="brief-proof live">
        <div>
          <span>Ritual-native extension</span>
          <h2>Encrypted answers can stay inside a TEE-backed batch judge.</h2>
          <p>{BOUNTY_JUDGE.reflection}</p>
        </div>
        <a className="brief-proof-link" href="https://docs.ritualfoundation.org/" target="_blank" rel="noreferrer">
          Ritual docs <ExternalLink size={16} />
        </a>
      </section>
    </PageShell>
  );
}

function PitchPage() {
  const [selectedPitch, setSelectedPitch] = useState(pitchRows[0][0]);
  const selectedPitchRow = pitchRows.find(([category]) => category === selectedPitch) ?? pitchRows[0];
  const pitchIndex = pitchRows.findIndex(([category]) => category === selectedPitchRow[0]);
  const edgeScore = 92 - pitchIndex * 3;

  return (
    <PageShell>
      <section className="pitch-grid">
        <div className="pitch-hero">
          <span className="eyebrow">
            <BadgeCheck size={16} />
            Positioning
          </span>
          <h1>Not a judge. A policy firewall.</h1>
          <p>
            Covenant is built for autonomous agents before execution: spending limits, secret controls, vault
            consequences, and machine recovery in one execution surface.
          </p>
          <div className="pitch-stance">
            <span>After-the-fact dispute tools</span>
            <strong>Pre-execution agent control</strong>
          </div>
        </div>
        <div className="pitch-table">
          <div className="pitch-row head">
            <span>Category</span>
            <span>Existing angle</span>
            <span>Covenant angle</span>
          </div>
          {pitchRows.map(([category, existing, covenant]) => (
            <div className="pitch-row" key={category}>
              <strong>{category}</strong>
              <span>{existing}</span>
              <span>{covenant}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="pitch-interactive">
        <div className="pitch-interactive-copy">
          <span>Differentiator lens</span>
          <h2>{selectedPitchRow[0]}</h2>
          <p>{selectedPitchRow[2]}</p>
        </div>
        <div className="pitch-choice-grid">
          {pitchRows.map(([category]) => (
            <button key={category} className={selectedPitch === category ? "active" : ""} onClick={() => setSelectedPitch(category)}>
              {category}
            </button>
          ))}
        </div>
        <div className="pitch-score">
          <span>Edge score</span>
          <strong>{edgeScore}/100</strong>
          <em>Against: {selectedPitchRow[1]}</em>
        </div>
      </section>
      <section className="primitive-grid compact">
        {[
          { name: "Policy before execution", icon: ShieldCheck, text: "Actions are checked before money or secrets move." },
          { name: "Economic enforcement", icon: Vault, text: "Escrow, cooldowns, and slashing turn policy into consequences." },
          { name: "Machine recovery", icon: Workflow, text: "Heartbeat failure can transfer state to a successor agent." },
        ].map(({ name, icon: Icon, text }) => (
          <article className="primitive-item" key={name}>
            <Icon size={22} />
            <h3>{name}</h3>
            <p>{text}</p>
            <strong>Built for Ritual</strong>
          </article>
        ))}
      </section>
    </PageShell>
  );
}

export default function App() {
  const [activePage, setActivePage] = useState<PageId>(() => getHashPage());
  const [selectedCaseId, setSelectedCaseId] = useState("CK-0001");
  const [liveState, setLiveState] = useState<LiveCovenantState | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("loading");
  const [liveError, setLiveError] = useState<string | null>(null);
  const liveCases = useMemo(() => caseFromLive(liveState, liveStatus, liveError), [liveError, liveState, liveStatus]);
  const selected = useMemo(() => liveCases.find((item) => item.id === selectedCaseId) ?? liveCases[0], [liveCases, selectedCaseId]);
  const copy = pageCopy[activePage];

  useEffect(() => {
    let cancelled = false;

    async function refreshLiveState() {
      try {
        const nextState = await fetchLiveCovenantState();
        if (cancelled) return;
        setLiveState(nextState);
        setLiveStatus("live");
        setLiveError(null);
        setSelectedCaseId((current) => (current.startsWith("CK-") ? current : `CK-${nextState.checkId.padStart(4, "0")}`));
      } catch (error) {
        if (cancelled) return;
        setLiveStatus("error");
        setLiveError(error instanceof Error ? error.message : "Unknown RPC error");
      }
    }

    refreshLiveState();
    const interval = window.setInterval(refreshLiveState, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const onHashChange = () => setActivePage(getHashPage());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [activePage]);

  const go = (page: PageId) => {
    window.location.hash = page;
    setActivePage(page);
  };

  return (
    <main className="app-shell">
      <CovenantScene mode={selected.kind} />
      <aside className="side-rail">
        <button className="brand-lockup" onClick={() => go("overview")} aria-label="Ritual Covenant home">
          <span className="brand-mark">
            <img src={ritualAssets.logo} alt="" />
          </span>
          <span>
            <strong>Ritual Covenant</strong>
            <em>Policy Firewall</em>
          </span>
        </button>
        <nav className="side-nav" aria-label="Workspace pages">
          {routes.map(({ id, label, icon: Icon, kicker }) => (
            <button key={id} className={activePage === id ? "active" : ""} onClick={() => go(id)}>
              <Icon size={18} />
              <span>
                <strong>{label}</strong>
                <em>{kicker}</em>
              </span>
            </button>
          ))}
        </nav>
        <div className="rail-status">
          <span>Ritual Testnet</span>
          <strong>{liveStatus === "live" ? RITUAL_TESTNET.status : liveStatus}</strong>
        </div>
      </aside>

      <section className="main-stage">
        <header className="stage-topbar">
          <div>
            <span className="stage-kicker">Agent control surface</span>
            <h2>{copy.title}</h2>
            <p>{copy.subtitle}</p>
          </div>
          <div className="topbar-actions">
            <a className="ghost-link" href="https://docs.ritualfoundation.org/" target="_blank" rel="noreferrer">
              Ritual Docs <ExternalLink size={14} />
            </a>
            <button className="primary-action small" onClick={() => go("contracts")}>
              <FileCode2 size={16} />
              Wiring
            </button>
            <div className="topbar-wallet">
              <ConnectButton accountStatus={{ smallScreen: "avatar", largeScreen: "address" }} chainStatus="icon" showBalance={false} />
            </div>
          </div>
        </header>

        {activePage === "overview" && (
          <OverviewPage
            cases={liveCases}
            selected={selected}
            onSelect={setSelectedCaseId}
            go={go}
            liveState={liveState}
            liveStatus={liveStatus}
            liveError={liveError}
          />
        )}
        {activePage === "firewall" && (
          <FirewallPage cases={liveCases} selected={selected} onSelect={setSelectedCaseId} liveState={liveState} liveStatus={liveStatus} />
        )}
        {activePage === "blackbox" && <BlackBoxPage liveState={liveState} liveStatus={liveStatus} liveError={liveError} />}
        {activePage === "bounty" && <BountyJudgePage />}
        {activePage === "agents" && <AgentsPage liveState={liveState} liveStatus={liveStatus} liveError={liveError} />}
        {activePage === "brief" && <BriefPage liveState={liveState} liveStatus={liveStatus} go={go} />}
        {activePage === "policy" && <PolicyStudioPage />}
        {activePage === "inheritance" && <InheritancePage liveState={liveState} liveStatus={liveStatus} />}
        {activePage === "contracts" && <ContractsPage liveState={liveState} liveStatus={liveStatus} liveError={liveError} />}
        {activePage === "pitch" && <PitchPage />}

        <footer className="stage-footer">
          <div className="footer-links">
            {stackLinks.map((link) => (
              <a href={link.href} target="_blank" rel="noreferrer" key={link.href}>
                {link.label}
              </a>
            ))}
          </div>
          <span>Live CovenantKernel on Ritual Chain Testnet</span>
        </footer>
      </section>
    </main>
  );
}
