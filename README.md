# Ritual Covenant

Agent Policy Firewall and Machine Inheritance for Ritual.

This frontend is a production-oriented Ritual control surface that can be wired to contracts after manual deployment. It includes interactive policy checks, primitive mapping, contract integration slots, and a React Three Fiber covenant chamber.

## Run

```bash
npm.cmd install
npm.cmd run contract:compile
npm.cmd run contract:test
npm.cmd run build
npm.cmd run serve
```

Open:

```text
http://127.0.0.1:5177/
```

`npm.cmd run dev` may fail in restricted Codex sandboxes because Vite dependency optimization tries to inspect parent directories. Use `npm.cmd run serve` for the reliable production preview.

## Contract Integration

The no-fee contract work is ready in:

```text
contracts/CovenantKernel.sol
```

`CovenantKernel` combines the registry, bond vault, intent gate, decision receipts, slashing, and heartbeat inheritance path in one self-contained Solidity file.

Deployed Ritual Chain Testnet address:

```text
0x4086710799f9d1Cb1eDb4D0a64522F00A5790270
```

Deployment tx:

```text
0xdd17daee2f10ec9489898b5ff3660cdfd11942223c2a167d99f404b09322cd30
```

Live smoke proof:

```text
agent #1 -> check #1 -> executeApproved tx 0xc2cfd5ee8d7e0106dd9a3067423731979e8f9c4b907b5f1e5a0762f1877e05fa
```

Run `npm.cmd run contract:test` before deployment. It locally deploys the kernel on chain id `1979` and checks owner-only intents, attestor-only decisions, bond accounting, slashing, EIP-712 registration, heartbeat inheritance, and Ritual-style millisecond timestamp normalization.

Frontend event feed targets:

- `AgentRegistered`
- `IntentSubmitted`
- `DecisionRecorded`
- `AgentSlashed`
- `WillExecuted`

More handoff details are in `contracts/README.md`.

## Demo Flow

1. Open the page.
2. Click `Test policy breach` to show the blocked treasury-spend policy.
3. Click `Trigger inheritance` to show heartbeat-triggered machine inheritance.
4. Scroll to contracts to show the manual deployment path.
