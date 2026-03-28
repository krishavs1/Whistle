// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title Whistle ReputationGate
 * @notice Tracks and manages reputation scores for AI agents
 * @dev Used to gate escrow terms and provide trust signals
 */
contract ReputationGate {
    // ============ Structs ============

    struct AgentStats {
        uint256 reputation;         // Current reputation score (0-1000)
        uint256 tasksCompleted;     // Total tasks successfully completed
        uint256 tasksDisputed;      // Total tasks that went to dispute
        uint256 disputesWon;        // Disputes ruled in agent's favor
        uint256 disputesLost;       // Disputes ruled against agent
        uint256 totalVolumeAsBuyer; // Total TRX volume as buyer
        uint256 totalVolumeAsSeller;// Total TRX volume as seller
        uint256 registeredAt;       // Timestamp of registration
        bool isRegistered;          // Whether agent is registered
    }

    // ============ Constants ============

    uint256 public constant MAX_REPUTATION = 1000;
    uint256 public constant INITIAL_REPUTATION = 500;

    // Reputation changes
    uint256 public constant TASK_COMPLETE_BONUS = 10;
    uint256 public constant DISPUTE_WIN_BONUS = 5;
    uint256 public constant DISPUTE_LOSS_PENALTY = 50;
    uint256 public constant DISPUTE_OPENED_PENALTY = 10; // Penalty for seller when dispute opened

    // ============ State Variables ============

    // Mapping from agent address to their stats
    mapping(address => AgentStats) public agents;

    // Addresses authorized to update reputation (Escrow contract)
    mapping(address => bool) public authorizedUpdaters;

    // Contract owner
    address public owner;

    // ============ Events ============

    event AgentRegistered(address indexed agent, uint256 initialReputation);

    event ReputationUpdated(
        address indexed agent,
        uint256 oldReputation,
        uint256 newReputation,
        string reason
    );

    event TaskRecorded(
        address indexed agent,
        bool asBuyer,
        uint256 amount,
        bool successful
    );

    event UpdaterAuthorized(address indexed updater, bool authorized);

    // ============ Modifiers ============

    modifier onlyOwner() {
        require(msg.sender == owner, "ReputationGate: caller is not owner");
        _;
    }

    modifier onlyAuthorized() {
        require(
            authorizedUpdaters[msg.sender] || msg.sender == owner,
            "ReputationGate: caller not authorized"
        );
        _;
    }

    modifier agentExists(address agent) {
        require(agents[agent].isRegistered, "ReputationGate: agent not registered");
        _;
    }

    // ============ Constructor ============

    constructor() {
        owner = msg.sender;
    }

    // ============ Registration Functions ============

    /**
     * @notice Register a new agent with initial reputation
     * @dev Agents must register before participating in tasks
     */
    function registerAgent() external {
        require(!agents[msg.sender].isRegistered, "ReputationGate: already registered");

        agents[msg.sender] = AgentStats({
            reputation: INITIAL_REPUTATION,
            tasksCompleted: 0,
            tasksDisputed: 0,
            disputesWon: 0,
            disputesLost: 0,
            totalVolumeAsBuyer: 0,
            totalVolumeAsSeller: 0,
            registeredAt: block.timestamp,
            isRegistered: true
        });

        emit AgentRegistered(msg.sender, INITIAL_REPUTATION);
    }

    /**
     * @notice Register an agent (can be called by authorized contracts)
     * @param agent Address of the agent to register
     */
    function registerAgentFor(address agent) external onlyAuthorized {
        if (agents[agent].isRegistered) return; // Silent return if already registered

        agents[agent] = AgentStats({
            reputation: INITIAL_REPUTATION,
            tasksCompleted: 0,
            tasksDisputed: 0,
            disputesWon: 0,
            disputesLost: 0,
            totalVolumeAsBuyer: 0,
            totalVolumeAsSeller: 0,
            registeredAt: block.timestamp,
            isRegistered: true
        });

        emit AgentRegistered(agent, INITIAL_REPUTATION);
    }

    // ============ Reputation Update Functions ============

    /**
     * @notice Record a successfully completed task
     * @param buyer Address of the buyer
     * @param seller Address of the seller
     * @param amount Task value in SUN
     */
    function recordTaskCompletion(
        address buyer,
        address seller,
        uint256 amount
    ) external onlyAuthorized {
        _ensureRegistered(buyer);
        _ensureRegistered(seller);

        // Update buyer stats
        agents[buyer].tasksCompleted++;
        agents[buyer].totalVolumeAsBuyer += amount;
        _adjustReputation(buyer, TASK_COMPLETE_BONUS, true, "task_completed_buyer");

        // Update seller stats (bigger bonus for completing work)
        agents[seller].tasksCompleted++;
        agents[seller].totalVolumeAsSeller += amount;
        _adjustReputation(seller, TASK_COMPLETE_BONUS * 2, true, "task_completed_seller");
    }

    /**
     * @notice Record a dispute being opened
     * @param buyer Address of the buyer who opened dispute
     * @param seller Address of the seller being disputed
     */
    function recordDisputeOpened(
        address buyer,
        address seller
    ) external onlyAuthorized {
        _ensureRegistered(buyer);
        _ensureRegistered(seller);

        agents[buyer].tasksDisputed++;
        agents[seller].tasksDisputed++;

        // Small penalty to seller when dispute is opened
        _adjustReputation(seller, DISPUTE_OPENED_PENALTY, false, "dispute_opened");
    }

    /**
     * @notice Record dispute resolution
     * @param winner Address of the dispute winner
     * @param loser Address of the dispute loser
     */
    function recordDisputeResolution(
        address winner,
        address loser
    ) external onlyAuthorized {
        _ensureRegistered(winner);
        _ensureRegistered(loser);

        // Winner gets small bonus
        agents[winner].disputesWon++;
        _adjustReputation(winner, DISPUTE_WIN_BONUS, true, "dispute_won");

        // Loser gets significant penalty
        agents[loser].disputesLost++;
        _adjustReputation(loser, DISPUTE_LOSS_PENALTY, false, "dispute_lost");
    }

    // ============ View Functions ============

    /**
     * @notice Get an agent's reputation score
     * @param agent Address of the agent
     * @return Reputation score (0-1000)
     */
    function getReputation(address agent) external view returns (uint256) {
        if (!agents[agent].isRegistered) return 0;
        return agents[agent].reputation;
    }

    /**
     * @notice Get full agent statistics
     * @param agent Address of the agent
     */
    function getAgentStats(address agent) external view returns (AgentStats memory) {
        return agents[agent];
    }

    /**
     * @notice Check if an agent meets minimum reputation threshold
     * @param agent Address of the agent
     * @param minReputation Minimum reputation required
     */
    function meetsReputationThreshold(
        address agent,
        uint256 minReputation
    ) external view returns (bool) {
        if (!agents[agent].isRegistered) return false;
        return agents[agent].reputation >= minReputation;
    }

    /**
     * @notice Calculate suggested escrow terms based on reputation
     * @param buyer Buyer address
     * @param seller Seller address
     * @param amount Task amount
     * @return suggestedDeposit Suggested security deposit for low-rep agents
     * @return requiresArbitration Whether arbitration should be mandatory
     */
    function getSuggestedTerms(
        address buyer,
        address seller,
        uint256 amount
    ) external view returns (
        uint256 suggestedDeposit,
        bool requiresArbitration
    ) {
        uint256 buyerRep = agents[buyer].isRegistered ? agents[buyer].reputation : 0;
        uint256 sellerRep = agents[seller].isRegistered ? agents[seller].reputation : 0;
        uint256 minRep = buyerRep < sellerRep ? buyerRep : sellerRep;

        // Low reputation = higher deposit requirement
        if (minRep < 300) {
            suggestedDeposit = amount / 2; // 50% deposit
            requiresArbitration = true;
        } else if (minRep < 500) {
            suggestedDeposit = amount / 4; // 25% deposit
            requiresArbitration = true;
        } else if (minRep < 700) {
            suggestedDeposit = amount / 10; // 10% deposit
            requiresArbitration = false;
        } else {
            suggestedDeposit = 0;
            requiresArbitration = false;
        }
    }

    /**
     * @notice Check if agent is registered
     * @param agent Address to check
     */
    function isRegistered(address agent) external view returns (bool) {
        return agents[agent].isRegistered;
    }

    // ============ Admin Functions ============

    /**
     * @notice Authorize an address to update reputation (e.g., Escrow contract)
     * @param updater Address to authorize
     * @param authorized Whether to authorize or revoke
     */
    function setAuthorizedUpdater(
        address updater,
        bool authorized
    ) external onlyOwner {
        authorizedUpdaters[updater] = authorized;
        emit UpdaterAuthorized(updater, authorized);
    }

    /**
     * @notice Transfer contract ownership
     * @param _newOwner New owner address
     */
    function transferOwnership(address _newOwner) external onlyOwner {
        require(_newOwner != address(0), "ReputationGate: invalid owner");
        owner = _newOwner;
    }

    // ============ Internal Functions ============

    /**
     * @dev Adjust an agent's reputation
     */
    function _adjustReputation(
        address agent,
        uint256 amount,
        bool increase,
        string memory reason
    ) internal {
        uint256 oldRep = agents[agent].reputation;
        uint256 newRep;

        if (increase) {
            newRep = oldRep + amount;
            if (newRep > MAX_REPUTATION) newRep = MAX_REPUTATION;
        } else {
            if (amount >= oldRep) {
                newRep = 0;
            } else {
                newRep = oldRep - amount;
            }
        }

        agents[agent].reputation = newRep;
        emit ReputationUpdated(agent, oldRep, newRep, reason);
    }

    /**
     * @dev Ensure an agent is registered, auto-register if not
     */
    function _ensureRegistered(address agent) internal {
        if (!agents[agent].isRegistered) {
            agents[agent] = AgentStats({
                reputation: INITIAL_REPUTATION,
                tasksCompleted: 0,
                tasksDisputed: 0,
                disputesWon: 0,
                disputesLost: 0,
                totalVolumeAsBuyer: 0,
                totalVolumeAsSeller: 0,
                registeredAt: block.timestamp,
                isRegistered: true
            });
            emit AgentRegistered(agent, INITIAL_REPUTATION);
        }
    }
}
