// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ResolutionRegistry
/// @notice Maps a Polymarket resolution question to the 0G Storage root hash
///         of the FIRST assessment ever run for it. This is the mechanism
///         that makes 0G integration load-bearing rather than decorative:
///         without an on-chain commit, a proposer could simply re-run the
///         off-chain tool until it returns a favorable answer and nobody
///         would know. Once committed here, the question is locked —
///         the same root hash is returned forever, on every future lookup.
contract ResolutionRegistry {
    struct Assessment {
        bytes32 rootHash;   // 0G Storage root hash of the full debate session
        address committer;  // who ran and paid for this assessment
        uint64 timestamp;   // block timestamp of commit
        uint8 verdict;      // 0 = YES, 1 = NO, 2 = UNCLEAR
        bool safeToPropose;
        bool exists;
    }

    // questionHash = keccak256(abi.encodePacked(marketQuestion, resolutionRules))
    mapping(bytes32 => Assessment) public assessments;

    event AssessmentCommitted(
        bytes32 indexed questionHash,
        bytes32 rootHash,
        address indexed committer,
        uint8 verdict,
        bool safeToPropose,
        uint64 timestamp
    );

    /// @notice Commits the first assessment for a question. Reverts if this
    ///         question has already been assessed — this is the entire point
    ///         of the contract. Without this revert, the registry would just
    ///         be a log, not a commitment device.
    function commitAssessment(
        bytes32 questionHash,
        bytes32 rootHash,
        uint8 verdict,
        bool safeToPropose
    ) external {
        require(!assessments[questionHash].exists, "ResolutionRegistry: question already assessed");
        require(verdict <= 2, "ResolutionRegistry: invalid verdict code");

        assessments[questionHash] = Assessment({
            rootHash: rootHash,
            committer: msg.sender,
            timestamp: uint64(block.timestamp),
            verdict: verdict,
            safeToPropose: safeToPropose,
            exists: true
        });

        emit AssessmentCommitted(questionHash, rootHash, msg.sender, verdict, safeToPropose, uint64(block.timestamp));
    }

    /// @notice Returns whether a question has already been assessed, and if
    ///         so, the full record. Anyone can call this for free (view).
    function getAssessment(bytes32 questionHash)
        external
        view
        returns (bytes32 rootHash, address committer, uint64 timestamp, uint8 verdict, bool safeToPropose, bool exists)
    {
        Assessment memory a = assessments[questionHash];
        return (a.rootHash, a.committer, a.timestamp, a.verdict, a.safeToPropose, a.exists);
    }
}
