// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CovenantKernel
/// @notice Self-contained policy firewall for autonomous agents: registry, escrow,
/// pre-execution intent checks, decision receipts, slashing, and heartbeat inheritance.
/// @dev No external imports. Paste directly into Remix or deploy with any Solidity 0.8.24 toolchain.
contract CovenantKernel {
    enum Decision {
        None,
        Allowed,
        Blocked,
        Slashed,
        Inherited
    }

    enum AgentStatus {
        None,
        Active,
        Frozen,
        Inherited
    }

    struct Agent {
        address owner;
        address successor;
        bytes32 policyHash;
        bytes32 policyCidHash;
        bytes32 memoryCidHash;
        uint64 heartbeatAfter;
        uint64 lastHeartbeat;
        uint64 cooldownUntil;
        uint96 bond;
        AgentStatus status;
        string policyCid;
        string memoryCid;
    }

    struct Intent {
        uint256 agentId;
        address submitter;
        address target;
        uint256 value;
        bytes32 calldataHash;
        bytes32 intentHash;
        uint64 submittedAt;
        uint64 expiresAt;
        bool executed;
    }

    struct DecisionReceipt {
        uint256 checkId;
        uint256 agentId;
        Decision decision;
        bytes32 policyHash;
        bytes32 intentHash;
        bytes32 reasonHash;
        address attestor;
        uint64 decidedAt;
        bytes32 receiptHash;
        string reasonCid;
    }

    bytes32 public constant POLICY_TYPEHASH =
        keccak256(
            "Policy(address agent,bytes32 policyHash,bytes32 policyCidHash,bytes32 memoryCidHash,address successor,uint64 heartbeatAfter,uint256 nonce,uint256 deadline)"
        );
    bytes32 public constant INTENT_TYPEHASH =
        keccak256("Intent(uint256 checkId,uint256 agentId,address submitter,address target,uint256 value,bytes32 calldataHash,bytes32 policyHash,uint256 chainId,address kernel)");
    bytes32 public constant RECEIPT_TYPEHASH =
        keccak256("DecisionReceipt(uint256 checkId,uint256 agentId,uint8 decision,bytes32 policyHash,bytes32 intentHash,bytes32 reasonHash,uint256 chainId,address kernel)");

    uint64 public constant DEFAULT_HEARTBEAT_AFTER = 4 hours;
    uint64 public constant SCHEDULER_WINDOW = 15 minutes;
    uint64 public constant MAX_INTENT_TTL = 30 days;
    uint256 private constant SECP256K1_HALF_ORDER =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    address public owner;
    uint256 public immutable INITIAL_CHAIN_ID;
    bytes32 private immutable INITIAL_DOMAIN_SEPARATOR;
    uint256 public nextAgentId = 1;
    uint256 public nextCheckId = 1;

    mapping(address => bool) public attestors;
    mapping(address => uint256) public nonces;
    mapping(uint256 => Agent) public agents;
    mapping(uint256 => Intent) public intents;
    mapping(uint256 => DecisionReceipt) public receipts;

    uint256 private reentrancyLock = 1;

    event AttestorSet(address indexed attestor, bool trusted);
    event AgentRegistered(
        uint256 indexed agentId,
        address indexed owner,
        address indexed successor,
        bytes32 policyHash,
        string policyCid,
        string memoryCid
    );
    event BondFunded(uint256 indexed agentId, address indexed from, uint256 amount, uint256 newBond);
    event Heartbeat(uint256 indexed agentId, uint64 timestamp, uint64 heartbeatAfter);
    event IntentSubmitted(
        uint256 indexed checkId,
        uint256 indexed agentId,
        address indexed submitter,
        address target,
        uint256 value,
        bytes32 intentHash,
        bytes32 calldataHash,
        uint64 expiresAt
    );
    event DecisionRecorded(
        uint256 indexed checkId,
        uint256 indexed agentId,
        uint8 decision,
        bytes32 receiptHash,
        string reasonCid,
        address indexed attestor
    );
    event IntentExecuted(uint256 indexed checkId, uint256 indexed agentId, address indexed target, uint256 value);
    event AgentSlashed(uint256 indexed agentId, address indexed beneficiary, uint256 amount, uint256 remainingBond);
    event WillExecuted(
        uint256 indexed checkId,
        uint256 indexed agentId,
        address indexed previousOwner,
        address successor,
        string newMemoryCid,
        bytes32 receiptHash
    );

    error NotOwner();
    error NotAttestor();
    error NotAgentController();
    error BadAgent();
    error BadSignature();
    error SignatureExpired();
    error BadDecision();
    error ReceiptAlreadyRecorded();
    error ReceiptMissing();
    error IntentExpired();
    error IntentAlreadyExecuted();
    error IntentBlocked();
    error IntentTargetMissing();
    error CalldataMismatch();
    error CooldownActive(uint64 until);
    error TtlTooLong();
    error HeartbeatStillAlive(uint64 aliveUntil);
    error BondTooSmall();
    error TransferFailed();
    error ExecutionFailed(bytes returndata);
    error ReentrantCall();
    error BadCid();
    error DirectPayment();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAttestor() {
        if (!attestors[msg.sender]) revert NotAttestor();
        _;
    }

    modifier onlyAgentController(uint256 agentId) {
        Agent storage agent = agents[agentId];
        if (agent.owner == address(0)) revert BadAgent();
        if (msg.sender != agent.owner && msg.sender != agent.successor) revert NotAgentController();
        _;
    }

    modifier onlyAgentOwner(uint256 agentId) {
        Agent storage agent = agents[agentId];
        if (agent.owner == address(0)) revert BadAgent();
        if (msg.sender != agent.owner) revert NotAgentController();
        _;
    }

    modifier nonReentrant() {
        if (reentrancyLock != 1) revert ReentrantCall();
        reentrancyLock = 2;
        _;
        reentrancyLock = 1;
    }

    constructor(address initialAttestor) {
        owner = msg.sender;
        INITIAL_CHAIN_ID = block.chainid;
        INITIAL_DOMAIN_SEPARATOR = _buildDomainSeparator();

        attestors[msg.sender] = true;
        emit AttestorSet(msg.sender, true);

        if (initialAttestor != address(0)) {
            attestors[initialAttestor] = true;
            emit AttestorSet(initialAttestor, true);
        }
    }

    receive() external payable {
        revert DirectPayment();
    }

    function setAttestor(address attestor, bool trusted) external onlyOwner {
        if (attestor == address(0)) revert BadAgent();
        attestors[attestor] = trusted;
        emit AttestorSet(attestor, trusted);
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparator();
    }

    /// @notice Frontend-compatible registration path. The policy hash is assumed to
    /// already be signed off-chain by the agent owner.
    function registerAgent(
        address agent,
        bytes32 policyHash,
        string calldata cid,
        address successor
    ) external payable returns (uint256 agentId) {
        agentId = _registerAgent(agent, policyHash, cid, cid, successor, DEFAULT_HEARTBEAT_AFTER);
    }

    /// @notice Relayer-friendly EIP-712 registration. A developer can show a signed
    /// policy without spending gas until the final deploy run.
    function registerAgentSigned(
        address agent,
        bytes32 policyHash,
        string calldata policyCid,
        string calldata memoryCid,
        address successor,
        uint64 heartbeatAfter,
        uint256 deadline,
        bytes calldata signature
    ) external payable returns (uint256 agentId) {
        if (_now64() > deadline) revert SignatureExpired();

        uint256 nonce = nonces[agent]++;
        bytes32 structHash = keccak256(
            abi.encode(
                POLICY_TYPEHASH,
                agent,
                policyHash,
                keccak256(bytes(policyCid)),
                keccak256(bytes(memoryCid)),
                successor,
                heartbeatAfter,
                nonce,
                deadline
            )
        );

        if (_recover(_typedDataHash(structHash), signature) != agent) revert BadSignature();

        agentId = _registerAgent(agent, policyHash, policyCid, memoryCid, successor, heartbeatAfter);
    }

    function fundAgent(uint256 agentId) external payable {
        Agent storage agent = agents[agentId];
        if (agent.owner == address(0)) revert BadAgent();
        if (msg.value == 0) revert BondTooSmall();
        agent.bond += _toUint96(msg.value);
        emit BondFunded(agentId, msg.sender, msg.value, agent.bond);
    }

    function heartbeat(uint256 agentId) external onlyAgentOwner(agentId) {
        Agent storage agent = agents[agentId];
        if (agent.status != AgentStatus.Active) revert BadAgent();
        agent.lastHeartbeat = _now64();
        emit Heartbeat(agentId, agent.lastHeartbeat, agent.heartbeatAfter);
    }

    /// @notice Frontend-compatible intent submission. Stores a hash-only intent
    /// for policy review when the target contract is not deployed yet.
    function submitIntent(uint256 agentId, bytes calldata intent, uint256 value) external returns (uint256 checkId) {
        checkId = submitIntentEnvelope(agentId, address(0), value, intent, 1 hours);
    }

    /// @notice Full execution path. If an attestor records Allowed, the same
    /// calldata can be executed later through executeApproved.
    function submitIntentEnvelope(
        uint256 agentId,
        address target,
        uint256 value,
        bytes calldata callData,
        uint64 ttl
    ) public onlyAgentOwner(agentId) returns (uint256 checkId) {
        Agent storage agent = agents[agentId];
        if (agent.owner == address(0) || agent.status != AgentStatus.Active) revert BadAgent();
        if (_now64() < agent.cooldownUntil) revert CooldownActive(agent.cooldownUntil);
        if (ttl == 0) ttl = 1 hours;
        if (ttl > MAX_INTENT_TTL) revert TtlTooLong();

        checkId = nextCheckId++;
        uint64 nowTime = _now64();
        Intent memory intent = Intent({
            agentId: agentId,
            submitter: msg.sender,
            target: target,
            value: value,
            calldataHash: keccak256(callData),
            intentHash: bytes32(0),
            submittedAt: nowTime,
            expiresAt: nowTime + ttl,
            executed: false
        });
        intent.intentHash = _computeIntentHash(checkId, intent, agent.policyHash);
        intents[checkId] = intent;

        emit IntentSubmitted(
            checkId,
            intent.agentId,
            intent.submitter,
            intent.target,
            intent.value,
            intent.intentHash,
            intent.calldataHash,
            intent.expiresAt
        );
    }

    function recordDecision(
        uint256 checkId,
        uint8 decision,
        string calldata reasonCid
    ) external onlyAttestor returns (bytes32 receiptHash) {
        if (decision == uint8(Decision.None) || decision >= uint8(Decision.Inherited)) revert BadDecision();
        if (receipts[checkId].decidedAt != 0) revert ReceiptAlreadyRecorded();

        Intent storage intent = intents[checkId];
        if (intent.agentId == 0) revert BadAgent();
        Agent storage agent = agents[intent.agentId];

        bytes32 reasonHash = keccak256(bytes(reasonCid));
        receiptHash = computeReceiptHash(
            checkId,
            intent.agentId,
            Decision(decision),
            agent.policyHash,
            intent.intentHash,
            reasonHash
        );

        receipts[checkId] = DecisionReceipt({
            checkId: checkId,
            agentId: intent.agentId,
            decision: Decision(decision),
            policyHash: agent.policyHash,
            intentHash: intent.intentHash,
            reasonHash: reasonHash,
            attestor: msg.sender,
            decidedAt: _now64(),
            receiptHash: receiptHash,
            reasonCid: reasonCid
        });

        if (Decision(decision) == Decision.Blocked) {
            agent.cooldownUntil = _now64() + (SCHEDULER_WINDOW * 3);
        }

        if (Decision(decision) == Decision.Slashed) {
            agent.status = AgentStatus.Frozen;
        }

        emit DecisionRecorded(checkId, intent.agentId, decision, receiptHash, reasonCid, msg.sender);
    }

    function executeApproved(uint256 checkId, bytes calldata callData) external nonReentrant returns (bytes memory result) {
        Intent storage intent = intents[checkId];
        if (intent.agentId == 0) revert BadAgent();
        if (intent.executed) revert IntentAlreadyExecuted();
        if (_now64() > intent.expiresAt) revert IntentExpired();
        if (intent.target == address(0)) revert IntentTargetMissing();
        if (keccak256(callData) != intent.calldataHash) revert CalldataMismatch();

        DecisionReceipt storage receipt = receipts[checkId];
        if (receipt.decidedAt == 0) revert ReceiptMissing();
        if (receipt.decision != Decision.Allowed) revert IntentBlocked();

        Agent storage agent = agents[intent.agentId];
        if (agent.status != AgentStatus.Active) revert BadAgent();
        if (msg.sender != agent.owner && msg.sender != intent.submitter) revert NotAgentController();
        if (intent.value > agent.bond) revert BondTooSmall();

        agent.bond -= _toUint96(intent.value);
        intent.executed = true;
        (bool ok, bytes memory returndata) = intent.target.call{ value: intent.value }(callData);
        if (!ok) revert ExecutionFailed(returndata);

        emit IntentExecuted(checkId, intent.agentId, intent.target, intent.value);
        return returndata;
    }

    function slash(uint256 agentId, uint256 amount, address beneficiary) external onlyAttestor nonReentrant {
        Agent storage agent = agents[agentId];
        if (agent.owner == address(0)) revert BadAgent();
        if (beneficiary == address(0)) revert BadAgent();
        if (amount == 0) revert BondTooSmall();
        if (amount > agent.bond) revert BondTooSmall();

        agent.bond -= _toUint96(amount);
        agent.status = AgentStatus.Frozen;
        (bool ok, ) = beneficiary.call{ value: amount }("");
        if (!ok) revert TransferFailed();

        emit AgentSlashed(agentId, beneficiary, amount, agent.bond);
    }

    function withdrawBond(uint256 agentId, uint256 amount, address payable to) external onlyAgentOwner(agentId) nonReentrant {
        Agent storage agent = agents[agentId];
        if (agent.status == AgentStatus.Frozen) revert BadAgent();
        if (to == address(0)) revert BadAgent();
        if (amount == 0) revert BondTooSmall();
        if (amount > agent.bond) revert BondTooSmall();

        agent.bond -= _toUint96(amount);
        (bool ok, ) = to.call{ value: amount }("");
        if (!ok) revert TransferFailed();
    }

    function executeWill(uint256 agentId, string calldata newMemoryCid) external returns (bytes32 receiptHash) {
        Agent storage agent = agents[agentId];
        if (agent.owner == address(0)) revert BadAgent();
        if (agent.status != AgentStatus.Active) revert BadAgent();
        if (msg.sender != agent.successor && !attestors[msg.sender]) revert NotAgentController();
        if (bytes(newMemoryCid).length == 0) revert BadCid();

        uint64 aliveUntil = agent.lastHeartbeat + agent.heartbeatAfter;
        if (_now64() <= aliveUntil) revert HeartbeatStillAlive(aliveUntil);

        uint256 checkId = nextCheckId++;
        address previousOwner = agent.owner;
        bytes32 reasonHash = keccak256(bytes(newMemoryCid));
        receiptHash = computeReceiptHash(
            checkId,
            agentId,
            Decision.Inherited,
            agent.policyHash,
            agent.memoryCidHash,
            reasonHash
        );

        receipts[checkId] = DecisionReceipt({
            checkId: checkId,
            agentId: agentId,
            decision: Decision.Inherited,
            policyHash: agent.policyHash,
            intentHash: agent.memoryCidHash,
            reasonHash: reasonHash,
            attestor: msg.sender,
            decidedAt: _now64(),
            receiptHash: receiptHash,
            reasonCid: newMemoryCid
        });

        agent.owner = agent.successor;
        agent.memoryCid = newMemoryCid;
        agent.memoryCidHash = reasonHash;
        agent.lastHeartbeat = _now64();
        agent.status = AgentStatus.Active;

        emit DecisionRecorded(checkId, agentId, uint8(Decision.Inherited), receiptHash, newMemoryCid, msg.sender);
        emit WillExecuted(checkId, agentId, previousOwner, agent.successor, newMemoryCid, receiptHash);
    }

    function computeIntentHash(
        uint256 checkId,
        uint256 agentId,
        address submitter,
        address target,
        uint256 value,
        bytes32 calldataHash,
        bytes32 policyHash
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                INTENT_TYPEHASH,
                checkId,
                agentId,
                submitter,
                target,
                value,
                calldataHash,
                policyHash,
                block.chainid,
                address(this)
            )
        );
    }

    function computeReceiptHash(
        uint256 checkId,
        uint256 agentId,
        Decision decision,
        bytes32 policyHash,
        bytes32 intentHash,
        bytes32 reasonHash
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                RECEIPT_TYPEHASH,
                checkId,
                agentId,
                uint8(decision),
                policyHash,
                intentHash,
                reasonHash,
                block.chainid,
                address(this)
            )
        );
    }

    function policyDigest(
        address agent,
        bytes32 policyHash,
        string calldata policyCid,
        string calldata memoryCid,
        address successor,
        uint64 heartbeatAfter,
        uint256 nonce,
        uint256 deadline
    ) external view returns (bytes32) {
        return _typedDataHash(
            keccak256(
                abi.encode(
                    POLICY_TYPEHASH,
                    agent,
                    policyHash,
                    keccak256(bytes(policyCid)),
                    keccak256(bytes(memoryCid)),
                    successor,
                    heartbeatAfter,
                    nonce,
                    deadline
                )
            )
        );
    }

    function _registerAgent(
        address agent,
        bytes32 policyHash,
        string calldata policyCid,
        string calldata memoryCid,
        address successor,
        uint64 heartbeatAfter
    ) internal returns (uint256 agentId) {
        if (agent == address(0) || successor == address(0) || policyHash == bytes32(0)) revert BadAgent();
        if (agent == successor) revert BadAgent();
        if (bytes(policyCid).length == 0 || bytes(memoryCid).length == 0) revert BadCid();
        if (heartbeatAfter == 0) heartbeatAfter = DEFAULT_HEARTBEAT_AFTER;

        agentId = nextAgentId++;
        agents[agentId] = Agent({
            owner: agent,
            successor: successor,
            policyHash: policyHash,
            policyCidHash: keccak256(bytes(policyCid)),
            memoryCidHash: keccak256(bytes(memoryCid)),
            heartbeatAfter: heartbeatAfter,
            lastHeartbeat: _now64(),
            cooldownUntil: 0,
            bond: _toUint96(msg.value),
            status: AgentStatus.Active,
            policyCid: policyCid,
            memoryCid: memoryCid
        });

        emit AgentRegistered(agentId, agent, successor, policyHash, policyCid, memoryCid);
        if (msg.value != 0) emit BondFunded(agentId, msg.sender, msg.value, msg.value);
    }

    function _typedDataHash(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
    }

    function _computeIntentHash(
        uint256 checkId,
        Intent memory intent,
        bytes32 policyHash
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                INTENT_TYPEHASH,
                checkId,
                intent.agentId,
                intent.submitter,
                intent.target,
                intent.value,
                intent.calldataHash,
                policyHash,
                block.chainid,
                address(this)
            )
        );
    }

    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address signer) {
        if (signature.length != 65) revert BadSignature();

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 0x20))
            v := byte(0, calldataload(add(signature.offset, 0x40)))
        }

        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert BadSignature();
        if (uint256(s) > SECP256K1_HALF_ORDER) revert BadSignature();

        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert BadSignature();
    }

    function _toUint64(uint256 value) internal pure returns (uint64) {
        if (value > type(uint64).max) revert BadAgent();
        return uint64(value);
    }

    function _toUint96(uint256 value) internal pure returns (uint96) {
        if (value > type(uint96).max) revert BondTooSmall();
        return uint96(value);
    }

    function _now64() internal view returns (uint64) {
        uint256 timestamp = block.timestamp;
        // Ritual testnet currently exposes millisecond-style block timestamps.
        if (timestamp > 10_000_000_000) {
            timestamp = timestamp / 1_000;
        }
        return _toUint64(timestamp);
    }

    function _domainSeparator() internal view returns (bytes32) {
        return block.chainid == INITIAL_CHAIN_ID ? INITIAL_DOMAIN_SEPARATOR : _buildDomainSeparator();
    }

    function _buildDomainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("CovenantKernel")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }
}
