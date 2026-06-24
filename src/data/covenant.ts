import {
  Activity,
  BadgeCheck,
  Coins,
  FileLock2,
  Gavel,
  HeartPulse,
  KeyRound,
  ShieldCheck,
  Siren,
  Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type CaseKind = "allowed" | "blocked" | "slashed" | "revived";

export type Primitive = {
  name: string;
  icon: LucideIcon;
  detail: string;
  state: string;
};

export const primitives: Primitive[] = [
  {
    name: "Policy Gate",
    icon: Gavel,
    detail: "Every agent intent is checked against signed policy before execution.",
    state: "TEE + LLM policy check",
  },
  {
    name: "Covenant Vault",
    icon: Coins,
    detail: "Bonds, premiums, payouts, and slashing are settled through escrow.",
    state: "Address binding",
  },
  {
    name: "Inheritance Engine",
    icon: FileLock2,
    detail: "Dead agents pass memory, rights, and funds to an authorized successor policy.",
    state: "Heartbeat trigger ready",
  },
  {
    name: "Secret Succession",
    icon: KeyRound,
    detail: "Encrypted keys are re-issued only after Covenant verifies the death condition.",
    state: "DKMS integration path",
  },
  {
    name: "Heartbeat Monitor",
    icon: HeartPulse,
    detail: "Agent liveness becomes an enforceable policy event, not just a status check.",
    state: "Scheduler compatible",
  },
  {
    name: "Enforcement Log",
    icon: Activity,
    detail: "Every blocked, slashed, or inherited action gets a machine-readable enforcement record.",
    state: "Event stream",
  },
];

export const clauses = [
  "No agent may spend above its epoch limit without a Covenant policy decision.",
  "No encrypted secret may be exposed to a non-party wallet.",
  "If heartbeat fails for four epochs, inheritance policy can execute.",
  "Successor agents inherit memory only after vault and liveness checks pass.",
  "A slashed agent cannot initiate high-risk intents for three scheduler windows.",
];

export const stackLinks = [
  { label: "Ritual", href: "https://ritual.net/" },
  { label: "Ritual Docs", href: "https://docs.ritualfoundation.org/" },
  { label: "Ritual Visualized", href: "https://visualized.ritualfoundation.org/" },
  { label: "Ritual Skills", href: "https://skills.ritualfoundation.org/" },
  { label: "Three.js", href: "https://github.com/mrdoob/three.js/" },
  { label: "React Three Fiber", href: "https://github.com/pmndrs/react-three-fiber" },
];

export const contractModules = [
  {
    name: "Kernel Registry",
    icon: BadgeCheck,
    purpose: "Registers agents, signed policies, successor rules, memory CIDs, and policy terms.",
  },
  {
    name: "Bond Lane",
    icon: ShieldCheck,
    purpose: "Holds bonded value, slashing balances, and recovery payouts inside the kernel.",
  },
  {
    name: "Intent Gate",
    icon: Siren,
    purpose: "Receives proposed actions, stores policy decisions, and blocks unsafe execution.",
  },
  {
    name: "Heartbeat Will",
    icon: Workflow,
    purpose: "Executes successor transfer after heartbeat or wallet failure conditions.",
  },
];
