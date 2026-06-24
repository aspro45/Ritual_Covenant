import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useMemo, useState } from "react";
import {
  encodeAbiParameters,
  isAddress,
  isHex,
  keccak256,
  stringToBytes,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import {
  useAccount,
  useChainId,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { bountyJudgeAbi } from "../lib/bountyJudge";
import { BOUNTY_JUDGE, RITUAL_TESTNET } from "../lib/contracts";
import { ritualTestnet } from "../lib/web3";

const bountyJudgeAddress = BOUNTY_JUDGE.address as Address;

function toBountyId(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? BigInt(Math.floor(parsed)) : 0n;
}

function validBytes32(value: string): value is Hex {
  return isHex(value) && value.length === 66;
}

function randomSalt() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function txUrl(hash?: Hex) {
  return hash ? `${RITUAL_TESTNET.explorerUrl}/tx/${hash}` : `${RITUAL_TESTNET.explorerUrl}/address/${bountyJudgeAddress}`;
}

export function BountyWorkbench() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const { writeContract, data: txHash, error: writeError, isPending: isWriting } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    chainId: ritualTestnet.id,
    hash: txHash,
  });

  const [bountyId, setBountyId] = useState("1");
  const [answer, setAnswer] = useState("");
  const [salt, setSalt] = useState(() => randomSalt());
  const [promptCid, setPromptCid] = useState("ipfs://ritual-covenant/bounty-prompt");
  const [promptText, setPromptText] = useState("Judge answers for originality, security, and Ritual-native design.");
  const [commitMinutes, setCommitMinutes] = useState("30");
  const [revealMinutes, setRevealMinutes] = useState("30");
  const [llmInput, setLlmInput] = useState("Batch input: prompt, eligible submission IDs, answer hashes, rubric, and judge notes.");
  const [winnerIndex, setWinnerIndex] = useState("0");
  const [lastAction, setLastAction] = useState("Ready for live contract calls.");

  const selectedBountyId = useMemo(() => toBountyId(bountyId), [bountyId]);
  const normalizedSalt = validBytes32(salt) ? salt : null;
  const onRitualChain = chainId === ritualTestnet.id;

  const commitment = useMemo(() => {
    if (!address || !answer.trim() || !normalizedSalt || selectedBountyId === 0n) return null;

    return keccak256(
      encodeAbiParameters(
        [
          { name: "answer", type: "string" },
          { name: "salt", type: "bytes32" },
          { name: "participant", type: "address" },
          { name: "bountyId", type: "uint256" },
        ],
        [answer, normalizedSalt, address, selectedBountyId],
      ),
    );
  }, [address, answer, normalizedSalt, selectedBountyId]);

  const { data: nextBountyId } = useReadContract({
    address: bountyJudgeAddress,
    abi: bountyJudgeAbi,
    chainId: ritualTestnet.id,
    functionName: "nextBountyId",
    query: {
      refetchInterval: 12_000,
    },
  });

  const { data: revealedCount } = useReadContract({
    address: bountyJudgeAddress,
    abi: bountyJudgeAbi,
    args: [selectedBountyId],
    chainId: ritualTestnet.id,
    functionName: "getRevealedSubmissionCount",
    query: {
      enabled: selectedBountyId > 0n,
      refetchInterval: 12_000,
    },
  });

  const canWrite = isConnected && onRitualChain && !isWriting && !isConfirming;
  const statusLabel = isWriting ? "Waiting for wallet" : isConfirming ? "Confirming on-chain" : isConfirmed ? "Confirmed" : lastAction;

  function ensureReady() {
    if (!isConnected) {
      setLastAction("Connect a wallet first.");
      return false;
    }

    if (!onRitualChain) {
      setLastAction("Switch to Ritual Chain Testnet first.");
      return false;
    }

    return true;
  }

  function createBounty() {
    if (!ensureReady()) return;

    const commitWindow = Math.max(1, Number(commitMinutes) || 1);
    const revealWindow = Math.max(1, Number(revealMinutes) || 1);
    const now = Math.floor(Date.now() / 1000);
    const commitDeadline = BigInt(now + commitWindow * 60);
    const revealDeadline = BigInt(now + (commitWindow + revealWindow) * 60);
    const promptHash = keccak256(stringToBytes(`${promptCid}|${promptText}`));

    setLastAction("Creating bounty.");
    writeContract({
      address: bountyJudgeAddress,
      abi: bountyJudgeAbi,
      functionName: "createBounty",
      args: [promptCid, promptHash, commitDeadline, revealDeadline],
    });
  }

  function submitCommitment() {
    if (!ensureReady() || !commitment) {
      setLastAction("Add answer, valid salt, and bounty ID before committing.");
      return;
    }

    setLastAction("Submitting hidden commitment.");
    writeContract({
      address: bountyJudgeAddress,
      abi: bountyJudgeAbi,
      functionName: "submitCommitment",
      args: [selectedBountyId, commitment],
    });
  }

  function revealAnswer() {
    if (!ensureReady() || !normalizedSalt || selectedBountyId === 0n || !answer.trim()) {
      setLastAction("Reveal needs the same answer, same wallet, same salt, and bounty ID.");
      return;
    }

    setLastAction("Revealing answer.");
    writeContract({
      address: bountyJudgeAddress,
      abi: bountyJudgeAbi,
      functionName: "revealAnswer",
      args: [selectedBountyId, answer, normalizedSalt],
    });
  }

  function judgeAll() {
    if (!ensureReady() || selectedBountyId === 0n || !llmInput.trim()) {
      setLastAction("Batch judging needs bounty ID and LLM input.");
      return;
    }

    setLastAction("Anchoring batch AI input.");
    writeContract({
      address: bountyJudgeAddress,
      abi: bountyJudgeAbi,
      functionName: "judgeAll",
      args: [selectedBountyId, stringToHex(llmInput)],
    });
  }

  function finalizeWinner() {
    if (!ensureReady() || selectedBountyId === 0n) {
      setLastAction("Finalization needs a bounty ID.");
      return;
    }

    setLastAction("Finalizing winner.");
    writeContract({
      address: bountyJudgeAddress,
      abi: bountyJudgeAbi,
      functionName: "finalizeWinner",
      args: [selectedBountyId, BigInt(Math.max(0, Number(winnerIndex) || 0))],
    });
  }

  return (
    <section className="bounty-workbench" aria-label="Live commit-reveal bounty workspace">
      <div className="workbench-head">
        <div>
          <span>Live wallet mode</span>
          <h2>Use the deployed bounty contract.</h2>
          <p>Connect a wallet on Ritual Chain Testnet, then create bounties, submit commitments, reveal answers, and finalize results on-chain.</p>
        </div>
        <div className="wallet-connect-shell">
          <ConnectButton />
        </div>
      </div>

      <div className="chain-status-row">
        <div>
          <span>Contract</span>
          <a href={`${RITUAL_TESTNET.explorerUrl}/address/${bountyJudgeAddress}`} target="_blank" rel="noreferrer">
            {BOUNTY_JUDGE.address}
          </a>
        </div>
        <div>
          <span>Next bounty ID</span>
          <strong>{nextBountyId?.toString() ?? "reading"}</strong>
        </div>
        <div>
          <span>Revealed for selected ID</span>
          <strong>{revealedCount?.toString() ?? "0"}</strong>
        </div>
        <div>
          <span>Network</span>
          {onRitualChain ? (
            <strong>Ritual ready</strong>
          ) : (
            <button type="button" onClick={() => switchChain({ chainId: ritualTestnet.id })} disabled={!isConnected || isSwitching}>
              Switch chain
            </button>
          )}
        </div>
      </div>

      <div className="bounty-action-grid">
        <article className="action-panel">
          <span>Organizer</span>
          <h3>Create bounty</h3>
          <label className="form-field">
            <span>Prompt CID</span>
            <input value={promptCid} onChange={(event) => setPromptCid(event.target.value)} />
          </label>
          <label className="form-field">
            <span>Rubric seed</span>
            <textarea value={promptText} onChange={(event) => setPromptText(event.target.value)} rows={3} />
          </label>
          <div className="dual-inputs">
            <label className="form-field">
              <span>Commit minutes</span>
              <input min="1" type="number" value={commitMinutes} onChange={(event) => setCommitMinutes(event.target.value)} />
            </label>
            <label className="form-field">
              <span>Reveal minutes</span>
              <input min="1" type="number" value={revealMinutes} onChange={(event) => setRevealMinutes(event.target.value)} />
            </label>
          </div>
          <button className="primary-action workbench-button" type="button" onClick={createBounty} disabled={!canWrite || !promptCid.trim()}>
            Create bounty
          </button>
        </article>

        <article className="action-panel featured">
          <span>Builder</span>
          <h3>Commit and reveal</h3>
          <label className="form-field">
            <span>Bounty ID</span>
            <input min="1" type="number" value={bountyId} onChange={(event) => setBountyId(event.target.value)} />
          </label>
          <label className="form-field">
            <span>Answer</span>
            <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} rows={4} />
          </label>
          <label className="form-field">
            <span>Salt</span>
            <input value={salt} onChange={(event) => setSalt(event.target.value)} />
          </label>
          <button className="secondary-action workbench-button" type="button" onClick={() => setSalt(randomSalt())}>
            Generate salt
          </button>
          <div className="commitment-preview">
            <span>Commitment</span>
            <code>{commitment ?? "Connect wallet and enter answer."}</code>
          </div>
          <div className="workbench-actions">
            <button className="primary-action workbench-button" type="button" onClick={submitCommitment} disabled={!canWrite || !commitment}>
              Submit commitment
            </button>
            <button className="secondary-action workbench-button" type="button" onClick={revealAnswer} disabled={!canWrite || !normalizedSalt || !answer.trim()}>
              Reveal answer
            </button>
          </div>
        </article>

        <article className="action-panel">
          <span>Judge</span>
          <h3>Batch and finalize</h3>
          <label className="form-field">
            <span>Batch LLM input</span>
            <textarea value={llmInput} onChange={(event) => setLlmInput(event.target.value)} rows={5} />
          </label>
          <label className="form-field">
            <span>Winner index</span>
            <input min="0" type="number" value={winnerIndex} onChange={(event) => setWinnerIndex(event.target.value)} />
          </label>
          <div className="workbench-actions">
            <button className="primary-action workbench-button" type="button" onClick={judgeAll} disabled={!canWrite || !llmInput.trim()}>
              Judge batch
            </button>
            <button className="secondary-action workbench-button" type="button" onClick={finalizeWinner} disabled={!canWrite || !isAddress(address ?? "0x0")}>
              Finalize
            </button>
          </div>
        </article>
      </div>

      <div className="workbench-status">
        <div>
          <span>Status</span>
          <strong>{statusLabel}</strong>
        </div>
        <div>
          <span>Transaction</span>
          {txHash ? (
            <a href={txUrl(txHash)} target="_blank" rel="noreferrer">
              {txHash}
            </a>
          ) : (
            <strong>No transaction yet.</strong>
          )}
        </div>
        {writeError && <p>{writeError.message}</p>}
      </div>
    </section>
  );
}
