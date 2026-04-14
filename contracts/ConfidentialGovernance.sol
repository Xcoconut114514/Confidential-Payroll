// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint8, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title ConfidentialGovernance - Private Board Voting
/// @notice Board members vote with encrypted ballots. Vote counts remain encrypted until
///         the proposal is finalized, at which point results become publicly decryptable.
///         Nobody can see how any individual voted — only final tallies are revealed.
contract ConfidentialGovernance is ZamaEthereumConfig {
    // ============ State ============

    address public admin;
    string public orgName;

    // Board members
    mapping(address => bool) public isBoardMember;
    address[] public boardMemberList;

    // Proposals
    struct Proposal {
        string title;
        string description;
        uint256 startTime;
        uint256 endTime;
        bool isFinalized;
        uint256 voterCount; // how many have voted
    }
    Proposal[] public proposals;

    // Encrypted vote tallies per proposal
    mapping(uint256 => euint64) private _yesVotes;
    mapping(uint256 => euint64) private _noVotes;

    // Who has voted (public — only that they voted, not how)
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    // ============ Events ============

    event BoardMemberAdded(address indexed member);
    event BoardMemberRemoved(address indexed member);
    event ProposalCreated(uint256 indexed proposalId, string title, uint256 endTime);
    event VoteCast(uint256 indexed proposalId, address indexed voter);
    event ProposalFinalized(uint256 indexed proposalId);

    // ============ Modifiers ============

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    modifier onlyBoardMember() {
        require(isBoardMember[msg.sender], "Not a board member");
        _;
    }

    // ============ Constructor ============

    constructor(string memory _orgName) {
        admin = msg.sender;
        orgName = _orgName;
    }

    // ============ Board Management ============

    function addBoardMember(address member) external onlyAdmin {
        require(member != address(0), "Invalid address");
        require(!isBoardMember[member], "Already a board member");
        isBoardMember[member] = true;
        boardMemberList.push(member);
        emit BoardMemberAdded(member);
    }

    function removeBoardMember(address member) external onlyAdmin {
        require(isBoardMember[member], "Not a board member");
        isBoardMember[member] = false;
        for (uint256 i = 0; i < boardMemberList.length; i++) {
            if (boardMemberList[i] == member) {
                boardMemberList[i] = boardMemberList[boardMemberList.length - 1];
                boardMemberList.pop();
                break;
            }
        }
        emit BoardMemberRemoved(member);
    }

    function getBoardMembers() external view returns (address[] memory) {
        return boardMemberList;
    }

    function getBoardMemberCount() external view returns (uint256) {
        return boardMemberList.length;
    }

    // ============ Proposal Management ============

    /// @notice Create a new proposal with a voting duration in seconds
    function createProposal(
        string calldata title,
        string calldata description,
        uint256 durationSeconds
    ) external onlyAdmin {
        require(durationSeconds > 0, "Duration must be > 0");

        uint256 proposalId = proposals.length;
        proposals.push(Proposal({
            title: title,
            description: description,
            startTime: block.timestamp,
            endTime: block.timestamp + durationSeconds,
            isFinalized: false,
            voterCount: 0
        }));

        // Initialize encrypted vote counts to zero
        _yesVotes[proposalId] = FHE.asEuint64(0);
        _noVotes[proposalId] = FHE.asEuint64(0);
        FHE.allowThis(_yesVotes[proposalId]);
        FHE.allowThis(_noVotes[proposalId]);
        FHE.allow(_yesVotes[proposalId], admin);
        FHE.allow(_noVotes[proposalId], admin);

        emit ProposalCreated(proposalId, title, block.timestamp + durationSeconds);
    }

    function getProposalCount() external view returns (uint256) {
        return proposals.length;
    }

    // ============ Voting ============

    /// @notice Cast an encrypted vote: 1 = yes, 0 = no (encrypted as euint8)
    /// @dev The contract never learns how each individual voted — only aggregates
    function vote(
        uint256 proposalId,
        externalEuint8 encVote,
        bytes calldata inputProof
    ) external onlyBoardMember {
        require(proposalId < proposals.length, "Invalid proposal");
        Proposal storage prop = proposals[proposalId];
        require(block.timestamp >= prop.startTime, "Voting not started");
        require(block.timestamp <= prop.endTime, "Voting ended");
        require(!prop.isFinalized, "Already finalized");
        require(!hasVoted[proposalId][msg.sender], "Already voted");

        // Convert encrypted input
        // We receive euint8 from the user, cast comparison against plaintext 1
        euint64 voteValue = FHE.asEuint64(FHE.fromExternal(encVote, inputProof));

        // If voteValue == 1, add 1 to yesVotes; otherwise add 1 to noVotes
        // This hides whether the voter chose yes or no
        ebool isYes = FHE.eq(voteValue, FHE.asEuint64(1));
        euint64 yesIncrement = FHE.select(isYes, FHE.asEuint64(1), FHE.asEuint64(0));
        euint64 noIncrement = FHE.select(isYes, FHE.asEuint64(0), FHE.asEuint64(1));

        _yesVotes[proposalId] = FHE.add(_yesVotes[proposalId], yesIncrement);
        _noVotes[proposalId] = FHE.add(_noVotes[proposalId], noIncrement);

        // ACL: contract + admin can access the running tallies
        FHE.allowThis(_yesVotes[proposalId]);
        FHE.allowThis(_noVotes[proposalId]);
        FHE.allow(_yesVotes[proposalId], admin);
        FHE.allow(_noVotes[proposalId], admin);

        hasVoted[proposalId][msg.sender] = true;
        prop.voterCount++;

        emit VoteCast(proposalId, msg.sender);
    }

    // ============ Finalization ============

    /// @notice Finalize a proposal after voting period ends — makes results publicly decryptable
    function finalizeProposal(uint256 proposalId) external onlyAdmin {
        require(proposalId < proposals.length, "Invalid proposal");
        Proposal storage prop = proposals[proposalId];
        require(block.timestamp > prop.endTime, "Voting not ended");
        require(!prop.isFinalized, "Already finalized");

        prop.isFinalized = true;

        // Make vote counts publicly decryptable by anyone
        FHE.makePubliclyDecryptable(_yesVotes[proposalId]);
        FHE.makePubliclyDecryptable(_noVotes[proposalId]);

        emit ProposalFinalized(proposalId);
    }

    // ============ View Functions ============

    /// @notice Admin views encrypted vote counts (before finalization)
    function viewVoteCounts(uint256 proposalId) external view returns (euint64 yesCount, euint64 noCount) {
        require(proposalId < proposals.length, "Invalid proposal");
        require(msg.sender == admin || proposals[proposalId].isFinalized, "Not authorized");
        return (_yesVotes[proposalId], _noVotes[proposalId]);
    }
}
