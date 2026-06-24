// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ICovenantKernel {
    function registerAgent(
        address agent,
        bytes32 policyHash,
        string calldata cid,
        address successor
    ) external payable returns (uint256 agentId);

    function heartbeat(uint256 agentId) external;

    function submitIntentEnvelope(
        uint256 agentId,
        address target,
        uint256 value,
        bytes calldata callData,
        uint64 ttl
    ) external returns (uint256 checkId);

    function recordDecision(
        uint256 checkId,
        uint8 decision,
        string calldata reasonCid
    ) external returns (bytes32 receiptHash);

    function executeApproved(uint256 checkId, bytes calldata callData) external returns (bytes memory result);

    function agents(
        uint256 agentId
    )
        external
        view
        returns (
            address owner,
            address successor,
            bytes32 policyHash,
            bytes32 policyCidHash,
            bytes32 memoryCidHash,
            uint64 heartbeatAfter,
            uint64 lastHeartbeat,
            uint64 cooldownUntil,
            uint96 bond,
            uint8 status
        );

    function intents(
        uint256 checkId
    )
        external
        view
        returns (
            uint256 agentId,
            address submitter,
            address target,
            uint256 value,
            bytes32 calldataHash,
            bytes32 intentHash,
            uint64 submittedAt,
            uint64 expiresAt,
            bool executed
        );

    function receipts(
        uint256 checkId
    )
        external
        view
        returns (
            uint256 storedCheckId,
            uint256 agentId,
            uint8 decision,
            bytes32 policyHash,
            bytes32 intentHash,
            bytes32 reasonHash,
            address attestor,
            uint64 decidedAt,
            bytes32 receiptHash
        );
}

/// @title CovenantGuardianAgent
/// @notice A deployable autonomous-agent companion for CovenantKernel. It can own
/// a kernel agent, pulse its heartbeat, submit intents, deterministically score
/// kernel intents, and write policy receipts when trusted as a kernel attestor.
/// @dev This contract is intentionally self-contained: no imports, no upgrade
/// hooks, and no hidden admin path. Scheduler/keeper calls can invoke the public
/// heartbeat and watch functions without being trusted with policy authority.
contract CovenantGuardianAgent {
    enum Decision {
        None,
        Allowed,
        Blocked,
        Slashed
    }

    uint8 public constant REASON_ALLOWED = 1;
    uint8 public constant REASON_VALUE_LIMIT = 2;
    uint8 public constant REASON_TARGET_DENIED = 3;
    uint8 public constant REASON_STALE_HEARTBEAT = 4;
    uint8 public constant REASON_INACTIVE_AGENT = 5;
    uint8 public constant REASON_EXPIRED_INTENT = 6;
    uint8 public constant REASON_REVOKED_CALLDATA = 7;
    uint8 public constant REASON_ALREADY_EXECUTED = 8;

    uint64 public constant MIN_HEARTBEAT_SPACING = 60;
    uint64 public constant DEFAULT_INTENT_TTL = 1 hours;
    uint256 public constant MAX_CID_BYTES = 160;

    struct WatchedIntent {
        uint256 agentId;
        address target;
        uint256 value;
        bytes32 calldataHash;
        uint64 expiresAt;
        bool executed;
    }

    struct WatchedAgent {
        address owner;
        uint64 heartbeatAfter;
        uint64 lastHeartbeat;
        uint8 status;
    }

    ICovenantKernel public immutable kernel;
    address public operator;
    bytes32 public immutable purposeHash;
    string public purposeCid;
    uint256 public kernelAgentId;
    uint256 public maxIntentValue;
    bool public requireTargetAllowlist;
    bool public paused;
    uint64 public lastGuardianPulse;

    mapping(address => bool) public allowedTargets;
    mapping(bytes32 => bool) public revokedCalldataHashes;
    mapping(uint8 => string) public reasonCids;

    event OperatorTransferred(address indexed previousOperator, address indexed nextOperator);
    event GuardianConfigured(uint256 maxIntentValue, bool requireTargetAllowlist);
    event PurposeUpdated(string purposeCid);
    event KernelAgentLinked(uint256 indexed kernelAgentId, bytes32 policyHash, string policyCid, address indexed successor);
    event GuardianPulse(uint256 indexed kernelAgentId, address indexed caller, uint64 timestamp);
    event GuardianIntentSubmitted(
        uint256 indexed checkId,
        uint256 indexed kernelAgentId,
        address indexed target,
        uint256 value,
        bytes32 calldataHash,
        string missionCid
    );
    event TargetPolicySet(address indexed target, bool allowed);
    event CalldataRevocationSet(bytes32 indexed calldataHash, bool revoked);
    event ReasonCidSet(uint8 indexed reasonCode, string reasonCid);
    event GuardianDecision(
        uint256 indexed checkId,
        uint256 indexed kernelAgentId,
        uint8 decision,
        uint8 reasonCode,
        bytes32 receiptHash
    );
    event PauseSet(bool paused);

    error NotOperator();
    error BadAddress();
    error BadKernelAgent();
    error AlreadyLinked();
    error NotLinked();
    error BadCid();
    error BadReason();
    error Paused();
    error AlreadyDecided();
    error PulseTooSoon(uint64 nextAllowed);

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    modifier whenActive() {
        if (paused) revert Paused();
        _;
    }

    constructor(
        address kernelAddress,
        bytes32 initialPurposeHash,
        string memory initialPurposeCid,
        uint256 initialMaxIntentValue,
        bool initialRequireTargetAllowlist
    ) {
        if (kernelAddress == address(0) || initialPurposeHash == bytes32(0)) revert BadAddress();
        _validateCid(initialPurposeCid);

        kernel = ICovenantKernel(kernelAddress);
        operator = msg.sender;
        purposeHash = initialPurposeHash;
        purposeCid = initialPurposeCid;
        maxIntentValue = initialMaxIntentValue;
        requireTargetAllowlist = initialRequireTargetAllowlist;

        reasonCids[REASON_ALLOWED] = "ipfs://covenant-guardian/allowed";
        reasonCids[REASON_VALUE_LIMIT] = "ipfs://covenant-guardian/value-limit";
        reasonCids[REASON_TARGET_DENIED] = "ipfs://covenant-guardian/target-denied";
        reasonCids[REASON_STALE_HEARTBEAT] = "ipfs://covenant-guardian/stale-heartbeat";
        reasonCids[REASON_INACTIVE_AGENT] = "ipfs://covenant-guardian/inactive-agent";
        reasonCids[REASON_EXPIRED_INTENT] = "ipfs://covenant-guardian/expired-intent";
        reasonCids[REASON_REVOKED_CALLDATA] = "ipfs://covenant-guardian/revoked-calldata";
        reasonCids[REASON_ALREADY_EXECUTED] = "ipfs://covenant-guardian/already-executed";

        emit OperatorTransferred(address(0), msg.sender);
        emit PurposeUpdated(initialPurposeCid);
        emit GuardianConfigured(initialMaxIntentValue, initialRequireTargetAllowlist);
    }

    function transferOperator(address nextOperator) external onlyOperator {
        if (nextOperator == address(0)) revert BadAddress();
        address previous = operator;
        operator = nextOperator;
        emit OperatorTransferred(previous, nextOperator);
    }

    function setPaused(bool nextPaused) external onlyOperator {
        paused = nextPaused;
        emit PauseSet(nextPaused);
    }

    function setPurposeCid(string calldata nextPurposeCid) external onlyOperator {
        _validateCid(nextPurposeCid);
        purposeCid = nextPurposeCid;
        emit PurposeUpdated(nextPurposeCid);
    }

    function setPolicyLimits(uint256 nextMaxIntentValue, bool nextRequireTargetAllowlist) external onlyOperator {
        maxIntentValue = nextMaxIntentValue;
        requireTargetAllowlist = nextRequireTargetAllowlist;
        emit GuardianConfigured(nextMaxIntentValue, nextRequireTargetAllowlist);
    }

    function setTargetAllowed(address target, bool allowed) external onlyOperator {
        if (target == address(0)) revert BadAddress();
        allowedTargets[target] = allowed;
        emit TargetPolicySet(target, allowed);
    }

    function setCalldataRevoked(bytes32 calldataHash, bool revoked) external onlyOperator {
        if (calldataHash == bytes32(0)) revert BadAddress();
        revokedCalldataHashes[calldataHash] = revoked;
        emit CalldataRevocationSet(calldataHash, revoked);
    }

    function setReasonCid(uint8 reasonCode, string calldata reasonCid) external onlyOperator {
        if (reasonCode == 0 || reasonCode > REASON_ALREADY_EXECUTED) revert BadReason();
        _validateCid(reasonCid);
        reasonCids[reasonCode] = reasonCid;
        emit ReasonCidSet(reasonCode, reasonCid);
    }

    /// @notice Registers this contract as the owner of a CovenantKernel agent.
    /// The agent can then submit intents and heartbeat through this contract.
    function registerWithKernel(
        bytes32 policyHash,
        string calldata policyCid,
        address successor
    ) external payable onlyOperator whenActive returns (uint256 agentId) {
        if (kernelAgentId != 0) revert AlreadyLinked();
        if (successor == address(0) || policyHash == bytes32(0)) revert BadAddress();
        _validateCid(policyCid);

        agentId = kernel.registerAgent{ value: msg.value }(address(this), policyHash, policyCid, successor);
        kernelAgentId = agentId;

        emit KernelAgentLinked(agentId, policyHash, policyCid, successor);
    }

    /// @notice Public keeper/scheduler hook. The caller pays gas, but the kernel
    /// sees this contract as the agent owner, so no external keeper gets control.
    function pulseKernelHeartbeat() external whenActive {
        uint256 agentId = kernelAgentId;
        if (agentId == 0) revert NotLinked();

        uint64 nowTime = _now64();
        uint64 nextAllowed = lastGuardianPulse + MIN_HEARTBEAT_SPACING;
        if (lastGuardianPulse != 0 && nowTime < nextAllowed) revert PulseTooSoon(nextAllowed);

        kernel.heartbeat(agentId);
        lastGuardianPulse = nowTime;
        emit GuardianPulse(agentId, msg.sender, nowTime);
    }

    function submitGuardianIntent(
        address target,
        uint256 value,
        bytes calldata callData,
        uint64 ttl,
        string calldata missionCid
    ) external onlyOperator whenActive returns (uint256 checkId) {
        uint256 agentId = kernelAgentId;
        if (agentId == 0) revert NotLinked();
        if (target == address(0)) revert BadAddress();
        _validateCid(missionCid);

        if (ttl == 0) ttl = DEFAULT_INTENT_TTL;
        checkId = kernel.submitIntentEnvelope(agentId, target, value, callData, ttl);

        emit GuardianIntentSubmitted(checkId, agentId, target, value, keccak256(callData), missionCid);
    }

    /// @notice Records a kernel decision using only on-chain facts and this
    /// guardian's configured limits. Requires the kernel owner to trust this
    /// contract as an attestor via CovenantKernel.setAttestor(address(this), true).
    function watchKernelIntent(uint256 checkId) external whenActive returns (uint8 decision, uint8 reasonCode, bytes32 receiptHash) {
        (, , uint8 existingDecision, , , , , uint64 decidedAt, ) = kernel.receipts(checkId);
        if (decidedAt != 0 || existingDecision != 0) revert AlreadyDecided();

        (decision, reasonCode, ) = previewDecision(checkId);
        string memory reasonCid = reasonCids[reasonCode];
        if (bytes(reasonCid).length == 0) revert BadReason();

        receiptHash = kernel.recordDecision(checkId, decision, reasonCid);

        (uint256 watchedAgentId, , , , , , , , ) = kernel.intents(checkId);
        emit GuardianDecision(checkId, watchedAgentId, decision, reasonCode, receiptHash);
    }

    function executeGuardianApproved(uint256 checkId, bytes calldata callData) external onlyOperator whenActive returns (bytes memory result) {
        return kernel.executeApproved(checkId, callData);
    }

    function previewDecision(uint256 checkId) public view returns (uint8 decision, uint8 reasonCode, string memory reasonCid) {
        WatchedIntent memory intent = _readIntent(checkId);
        if (intent.agentId == 0) revert BadKernelAgent();
        if (intent.executed) return _decision(Decision.Blocked, REASON_ALREADY_EXECUTED);

        WatchedAgent memory agent = _readAgent(intent.agentId);
        if (agent.owner == address(0)) revert BadKernelAgent();
        if (agent.status != 1) return _decision(Decision.Slashed, REASON_INACTIVE_AGENT);

        uint64 nowTime = _now64();
        if (intent.expiresAt != 0 && nowTime > intent.expiresAt) return _decision(Decision.Blocked, REASON_EXPIRED_INTENT);
        if (agent.lastHeartbeat + agent.heartbeatAfter < nowTime) return _decision(Decision.Blocked, REASON_STALE_HEARTBEAT);
        if (revokedCalldataHashes[intent.calldataHash]) return _decision(Decision.Blocked, REASON_REVOKED_CALLDATA);
        if (maxIntentValue != 0 && intent.value > maxIntentValue) return _decision(Decision.Blocked, REASON_VALUE_LIMIT);
        if (requireTargetAllowlist && intent.target != address(0) && !allowedTargets[intent.target]) {
            return _decision(Decision.Blocked, REASON_TARGET_DENIED);
        }

        return _decision(Decision.Allowed, REASON_ALLOWED);
    }

    function _readIntent(uint256 checkId) internal view returns (WatchedIntent memory intent) {
        (
            intent.agentId,
            ,
            intent.target,
            intent.value,
            intent.calldataHash,
            ,
            ,
            intent.expiresAt,
            intent.executed
        ) = kernel.intents(checkId);
    }

    function _readAgent(uint256 agentId) internal view returns (WatchedAgent memory agent) {
        (
            agent.owner,
            ,
            ,
            ,
            ,
            agent.heartbeatAfter,
            agent.lastHeartbeat,
            ,
            ,
            agent.status
        ) = kernel.agents(agentId);
    }

    function _decision(Decision decision, uint8 reasonCode) internal view returns (uint8, uint8, string memory) {
        return (uint8(decision), reasonCode, reasonCids[reasonCode]);
    }

    function _validateCid(string memory cid) internal pure {
        uint256 cidLength = bytes(cid).length;
        if (cidLength == 0 || cidLength > MAX_CID_BYTES) revert BadCid();
    }

    function _now64() internal view returns (uint64) {
        uint256 timestamp = block.timestamp;
        if (timestamp > 10_000_000_000) {
            timestamp = timestamp / 1_000;
        }
        if (timestamp > type(uint64).max) revert BadKernelAgent();
        return uint64(timestamp);
    }
}
