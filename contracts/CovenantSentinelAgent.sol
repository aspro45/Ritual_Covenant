// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CovenantSentinelAgent
/// @notice Direct Sovereign Agent consumer for Ritual Covenant. The contract
/// invokes the 0x080C agent precompile and records a compact on-chain receipt
/// when AsyncDelivery returns the TEE result.
contract CovenantSentinelAgent {
    address public constant SOVEREIGN_AGENT = address(0x080C);
    address public constant ASYNC_DELIVERY = 0x5A16214fF555848411544b005f7Ac063742f39F6;

    struct StorageRef {
        string platform;
        string path;
        string keyRef;
    }

    address public immutable owner;
    address public immutable covenantKernel;
    address public immutable bountyJudge;

    string public missionCid;
    uint256 public runCount;
    bytes32 public lastRequestHash;
    bytes32 public lastJobId;
    bytes32 public lastResultHash;
    bool public lastSuccess;
    uint256 public lastResultLength;
    uint256 public lastTextLength;

    event SentinelMissionUpdated(string missionCid);
    event SovereignAgentSubmitted(
        bytes32 indexed requestHash,
        address indexed operator,
        uint256 indexed runCount,
        string missionCid
    );
    event SovereignAgentResultDelivered(bytes32 indexed jobId, bytes result);
    event SentinelResult(
        bytes32 indexed jobId,
        bool success,
        bytes32 textHash,
        bytes32 errorHash,
        uint256 textLength,
        uint256 artifactCount
    );

    error NotOwner();
    error NotAsyncDelivery();
    error SovereignAgentCallFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address kernel_, address bountyJudge_, string memory missionCid_) {
        owner = msg.sender;
        covenantKernel = kernel_;
        bountyJudge = bountyJudge_;
        missionCid = missionCid_;
        emit SentinelMissionUpdated(missionCid_);
    }

    function setMissionCid(string calldata newMissionCid) external onlyOwner {
        missionCid = newMissionCid;
        emit SentinelMissionUpdated(newMissionCid);
    }

    function callSovereignAgent(bytes calldata input) external onlyOwner returns (bytes memory output) {
        bytes32 requestHash = keccak256(input);
        runCount += 1;
        lastRequestHash = requestHash;

        (bool ok, bytes memory returned) = SOVEREIGN_AGENT.call(input);
        if (!ok) revert SovereignAgentCallFailed();

        emit SovereignAgentSubmitted(requestHash, msg.sender, runCount, missionCid);
        return returned;
    }

    function onSovereignAgentResult(bytes32 jobId, bytes calldata result) external {
        if (msg.sender != ASYNC_DELIVERY) revert NotAsyncDelivery();

        lastJobId = jobId;
        lastResultHash = keccak256(result);
        lastResultLength = result.length;

        emit SovereignAgentResultDelivered(jobId, result);

        try this.decodeSovereignResult(result) returns (
            bool success,
            string memory errorText,
            string memory responseText,
            uint256 artifactCount
        ) {
            lastSuccess = success && bytes(errorText).length == 0 && bytes(responseText).length != 0;
            lastTextLength = bytes(responseText).length;
            emit SentinelResult(
                jobId,
                lastSuccess,
                keccak256(bytes(responseText)),
                keccak256(bytes(errorText)),
                bytes(responseText).length,
                artifactCount
            );
        } catch {
            lastSuccess = false;
            lastTextLength = 0;
            emit SentinelResult(jobId, false, bytes32(0), keccak256("decode failed"), 0, 0);
        }
    }

    function decodeSovereignResult(bytes calldata result)
        external
        pure
        returns (bool success, string memory errorText, string memory responseText, uint256 artifactCount)
    {
        StorageRef memory ignoredHistory;
        StorageRef memory ignoredOutput;
        StorageRef[] memory artifacts;
        (success, errorText, responseText, ignoredHistory, ignoredOutput, artifacts) =
            abi.decode(result, (bool, string, string, StorageRef, StorageRef, StorageRef[]));
        artifactCount = artifacts.length;
    }

    function describe() external view returns (string memory) {
        return missionCid;
    }
}
