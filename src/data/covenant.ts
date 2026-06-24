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
  { label: "Contract", href: "https://explorer.ritualfoundation.org/address/0x4086710799f9d1Cb1eDb4D0a64522F00A5790270" },
  { label: "Live execution", href: "https://explorer.ritualfoundation.org/tx/0xc2cfd5ee8d7e0106dd9a3067423731979e8f9c4b907b5f1e5a0762f1877e05fa" },
  { label: "Ritual Explorer", href: "https://explorer.ritualfoundation.org/" },
  { label: "Ritual Docs", href: "https://docs.ritualfoundation.org/" },
  { label: "Ritual Whitepaper", href: "https://whitepaper.ritualfoundation.org/" },
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
