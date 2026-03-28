// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IReputationGate {
    function registerAgentFor(address agent) external;
    function recordTaskCompletion(address buyer, address seller, uint256 amount) external;
    function recordDisputeOpened(address buyer, address seller) external;
    function recordDisputeResolution(address winner, address loser) external;
    function getSuggestedTerms(address buyer, address seller, uint256 amount) external view returns (uint256, bool);
    function getReputation(address agent) external view returns (uint256);
}

interface IArbitratorPool {
    function assignPanel(bytes32 taskId) external;
}

/**
 * @title Whistle Escrow
 * @notice Core escrow contract for AI agent commerce with dispute resolution
 * @dev Handles task creation, deadlines, deliverable submission, approval, and arbitration
 */
contract Escrow {
    // ============ Enums ============

    enum TaskState {
        Created,    // Task created but not yet funded
        Funded,     // Buyer has locked funds in escrow
        Delivered,  // Seller has submitted deliverable
        Approved,   // Buyer approved, funds released to seller
        Disputed,   // Buyer opened a dispute
        Resolved,   // Arbitrator resolved the dispute
        Cancelled   // Buyer cancelled after seller missed deadline
    }

    enum DisputeRuling {
        None,           // No ruling yet
        RefundBuyer,    // Arbitrator ruled in favor of buyer
        PaySeller       // Arbitrator ruled in favor of seller
    }

    enum DisputeReason {
        None,
        QualityIssue,
        BuyerSilence,
        SellerAbuse,
        ScopeChange,
        Other
    }

    // ============ Structs ============

    struct Task {
        address buyer;              // Address of the buyer/task creator
        address seller;             // Address of the seller/service provider
        uint256 amount;             // Escrowed amount in SUN (TRX smallest unit)
        string taskSpecCID;         // Filecoin CID of task specification
        string deliverableCID;      // Filecoin CID of submitted deliverable
        TaskState state;            // Current state of the task
        DisputeRuling ruling;       // Dispute ruling (if any)
        DisputeReason disputeReason;// Why dispute was opened
        address disputeOpenedBy;    // Who opened dispute
        uint256 createdAt;          // Timestamp of task creation
        uint256 deliverBy;          // Seller deadline to submit deliverable
        uint256 reviewBy;           // Buyer deadline to approve/dispute after delivery
        uint256 reviewWindow;       // Review window length in seconds
        uint256 deliveredAt;        // Timestamp of deliverable submission
        uint256 resolvedAt;         // Timestamp of resolution
    }

    // ============ State Variables ============

    // Mapping from taskId to Task struct
    mapping(bytes32 => Task) private tasks;

    // Designated arbitrator address (single EOA fallback)
    address public arbitrator;

    // ArbitratorPool for multi-sig panel voting (address(0) = disabled)
    IArbitratorPool public arbitratorPool;

    // Contract owner for admin functions
    address public owner;

    // ReputationGate contract
    IReputationGate public reputationGate;

    // Platform fee percentage (in basis points, e.g., 100 = 1%)
    uint256 public platformFeeBps = 100;

    // Accumulated platform fees
    uint256 public platformFees;

    // Optional minimum reputation required to create tasks (0 = disabled)
    uint256 public minimumReputation;

    // Default windows when zero is passed into createTask
    uint256 public defaultDeliveryWindow = 72 hours;
    uint256 public defaultReviewWindow = 72 hours;

    // ============ Events ============

    event TaskCreated(
        bytes32 indexed taskId,
        address indexed buyer,
        address indexed seller,
        uint256 amount,
        string taskSpecCID,
        uint256 deliverBy,
        uint256 reviewWindow
    );

    event DeliverableSubmitted(
        bytes32 indexed taskId,
        address indexed seller,
        string deliverableCID
    );

    event DeliverableApproved(
        bytes32 indexed taskId,
        address indexed buyer,
        address indexed seller,
        uint256 amount
    );

    event DisputeOpened(
        bytes32 indexed taskId,
        address indexed opener,
        DisputeReason reason
    );

    event DisputeResolved(
        bytes32 indexed taskId,
        DisputeRuling ruling,
        address indexed winner
    );

    event TaskCancelled(bytes32 indexed taskId, address indexed buyer, string reason);
    event ArbitratorUpdated(address indexed oldArbitrator, address indexed newArbitrator);
    event ArbitratorPoolUpdated(address indexed oldPool, address indexed newPool);
    event ReputationGateUpdated(address indexed oldReputationGate, address indexed newReputationGate);
    event MinimumReputationUpdated(uint256 oldValue, uint256 newValue);
    event DefaultWindowsUpdated(uint256 deliveryWindow, uint256 reviewWindow);

    // ============ Modifiers ============

    modifier onlyOwner() {
        require(msg.sender == owner, "Escrow: caller is not owner");
        _;
    }

    modifier onlyArbitrator() {
        require(
            msg.sender == arbitrator || msg.sender == address(arbitratorPool),
            "Escrow: caller is not arbitrator or pool"
        );
        _;
    }

    modifier taskExists(bytes32 taskId) {
        require(tasks[taskId].buyer != address(0), "Escrow: task does not exist");
        _;
    }

    // ============ Constructor ============

    /**
     * @notice Initialize the escrow contract
     * @param _arbitrator Address of the designated arbitrator
     * @param _reputationGate ReputationGate contract address
     */
    constructor(address _arbitrator, address _reputationGate) {
        require(_arbitrator != address(0), "Escrow: invalid arbitrator address");
        require(_reputationGate != address(0), "Escrow: invalid reputation gate address");
        owner = msg.sender;
        arbitrator = _arbitrator;
        reputationGate = IReputationGate(_reputationGate);
    }

    // ============ Core Functions ============

    /**
     * @notice Create a new task and lock funds in escrow
     * @param taskId Unique identifier for the task (generated off-chain)
     * @param seller Address of the seller who will fulfill the task
     * @param taskSpecCID Filecoin CID containing task specification/requirements
     * @param deliverByTimestamp Optional absolute deadline for delivery (0 = default window)
     * @param reviewWindowSeconds Optional buyer review/dispute window after delivery (0 = default window)
     * @dev Buyer sends TRX which gets locked in the contract
     */
    function createTask(
        bytes32 taskId,
        address seller,
        string calldata taskSpecCID,
        uint256 deliverByTimestamp,
        uint256 reviewWindowSeconds
    ) external payable {
        require(msg.value > 0, "Escrow: must send TRX to create task");
        require(seller != address(0), "Escrow: invalid seller address");
        require(seller != msg.sender, "Escrow: buyer cannot be seller");
        require(tasks[taskId].buyer == address(0), "Escrow: task already exists");
        require(bytes(taskSpecCID).length > 0, "Escrow: taskSpecCID required");

        reputationGate.registerAgentFor(msg.sender);
        reputationGate.registerAgentFor(seller);

        _enforceMinimumReputation(msg.sender, seller);
        _enforceSuggestedTerms(msg.sender, seller, msg.value);

        uint256 deliverBy = _resolveDeliverBy(deliverByTimestamp);
        uint256 reviewWindow = _resolveReviewWindow(reviewWindowSeconds);

        Task storage task = tasks[taskId];
        task.buyer = msg.sender;
        task.seller = seller;
        task.amount = msg.value;
        task.taskSpecCID = taskSpecCID;
        task.state = TaskState.Funded;
        task.ruling = DisputeRuling.None;
        task.disputeReason = DisputeReason.None;
        task.disputeOpenedBy = address(0);
        task.createdAt = block.timestamp;
        task.deliverBy = deliverBy;
        task.reviewWindow = reviewWindow;

        emit TaskCreated(
            taskId,
            msg.sender,
            seller,
            msg.value,
            taskSpecCID,
            deliverBy,
            reviewWindow
        );
    }

    /**
     * @notice Seller submits their deliverable for a task
     * @param taskId The task to submit deliverable for
     * @param deliverableCID Filecoin CID containing the deliverable
     */
    function submitDeliverable(
        bytes32 taskId,
        string calldata deliverableCID
    ) external taskExists(taskId) {
        Task storage task = tasks[taskId];

        require(msg.sender == task.seller, "Escrow: caller is not seller");
        require(task.state == TaskState.Funded, "Escrow: task not in funded state");
        require(bytes(deliverableCID).length > 0, "Escrow: deliverableCID required");
        require(block.timestamp <= task.deliverBy, "Escrow: delivery deadline passed");

        task.deliverableCID = deliverableCID;
        task.state = TaskState.Delivered;
        task.deliveredAt = block.timestamp;
        task.reviewBy = block.timestamp + task.reviewWindow;

        emit DeliverableSubmitted(taskId, msg.sender, deliverableCID);
    }

    /**
     * @notice Buyer approves the deliverable and releases funds to seller
     * @param taskId The task to approve
     * @dev Deducts platform fee and transfers remaining amount to seller
     */
    function approveDeliverable(bytes32 taskId) external taskExists(taskId) {
        Task storage task = tasks[taskId];

        require(msg.sender == task.buyer, "Escrow: caller is not buyer");
        require(task.state == TaskState.Delivered, "Escrow: task not in delivered state");
        require(block.timestamp <= task.reviewBy, "Escrow: review window expired");

        task.state = TaskState.Approved;
        task.resolvedAt = block.timestamp;

        // Calculate and deduct platform fee
        uint256 fee = (task.amount * platformFeeBps) / 10000;
        uint256 sellerAmount = task.amount - fee;
        platformFees += fee;

        // Transfer funds to seller
        (bool success, ) = payable(task.seller).call{value: sellerAmount}("");
        require(success, "Escrow: transfer to seller failed");

        reputationGate.recordTaskCompletion(task.buyer, task.seller, task.amount);
        emit DeliverableApproved(taskId, task.buyer, task.seller, sellerAmount);
    }

    /**
     * @notice Buyer opens a dispute for a delivered task
     * @param taskId The task to dispute
     */
    function openDisputeByBuyer(
        bytes32 taskId,
        DisputeReason reason
    ) external taskExists(taskId) {
        Task storage task = tasks[taskId];

        require(msg.sender == task.buyer, "Escrow: caller is not buyer");
        require(task.state == TaskState.Delivered, "Escrow: can only dispute delivered tasks");
        require(block.timestamp <= task.reviewBy, "Escrow: review window expired");
        _openDispute(taskId, msg.sender, reason);
    }

    /**
     * @notice Seller opens a dispute for a delivered task
     * @param taskId The task to dispute
     * @param reason The seller's dispute reason
     */
    function openDisputeBySeller(
        bytes32 taskId,
        DisputeReason reason
    ) external taskExists(taskId) {
        Task storage task = tasks[taskId];
        require(msg.sender == task.seller, "Escrow: caller is not seller");
        require(task.state == TaskState.Delivered, "Escrow: can only dispute delivered tasks");
        _openDispute(taskId, msg.sender, reason);
    }

    /**
     * @notice Seller escalates when buyer is silent after review deadline
     * @param taskId The task to escalate
     */
    function escalateBuyerSilence(bytes32 taskId) external taskExists(taskId) {
        Task storage task = tasks[taskId];
        require(msg.sender == task.seller, "Escrow: caller is not seller");
        require(task.state == TaskState.Delivered, "Escrow: task not in delivered state");
        require(task.reviewBy > 0 && block.timestamp > task.reviewBy, "Escrow: review window not expired");
        _openDispute(taskId, msg.sender, DisputeReason.BuyerSilence);
    }

    /**
     * @notice Buyer cancels and refunds if seller missed delivery deadline
     * @param taskId The task to cancel
     */
    function cancelForMissedDelivery(bytes32 taskId) external taskExists(taskId) {
        Task storage task = tasks[taskId];
        require(msg.sender == task.buyer, "Escrow: caller is not buyer");
        require(task.state == TaskState.Funded, "Escrow: task not in funded state");
        require(block.timestamp > task.deliverBy, "Escrow: delivery deadline not passed");

        task.state = TaskState.Cancelled;
        task.ruling = DisputeRuling.RefundBuyer;
        task.resolvedAt = block.timestamp;

        (bool success, ) = payable(task.buyer).call{value: task.amount}("");
        require(success, "Escrow: refund to buyer failed");
        emit TaskCancelled(taskId, task.buyer, "Seller missed delivery deadline");
    }

    /**
     * @notice Arbitrator resolves a disputed task
     * @param taskId The disputed task
     * @param ruling 0 = refund buyer, 1 = pay seller
     */
    function resolveDispute(
        bytes32 taskId,
        uint8 ruling
    ) external onlyArbitrator taskExists(taskId) {
        Task storage task = tasks[taskId];

        require(task.state == TaskState.Disputed, "Escrow: task not in disputed state");
        require(ruling <= 1, "Escrow: invalid ruling");

        task.state = TaskState.Resolved;
        task.resolvedAt = block.timestamp;

        if (ruling == 0) {
            // Refund buyer
            task.ruling = DisputeRuling.RefundBuyer;
            (bool success, ) = payable(task.buyer).call{value: task.amount}("");
            require(success, "Escrow: refund to buyer failed");
            reputationGate.recordDisputeResolution(task.buyer, task.seller);
            emit DisputeResolved(taskId, DisputeRuling.RefundBuyer, task.buyer);
        } else {
            // Pay seller (with platform fee deduction)
            task.ruling = DisputeRuling.PaySeller;
            uint256 fee = (task.amount * platformFeeBps) / 10000;
            uint256 sellerAmount = task.amount - fee;
            platformFees += fee;

            (bool success, ) = payable(task.seller).call{value: sellerAmount}("");
            require(success, "Escrow: payment to seller failed");
            reputationGate.recordDisputeResolution(task.seller, task.buyer);
            emit DisputeResolved(taskId, DisputeRuling.PaySeller, task.seller);
        }
    }

    // ============ View Functions ============

    /**
     * @notice Get full task details
     * @param taskId The task to query
     */
    function getTask(
        bytes32 taskId
    ) external view returns (
        address buyer,
        address seller,
        uint256 amount,
        string memory taskSpecCID,
        string memory deliverableCID,
        TaskState state,
        DisputeRuling ruling,
        uint256 createdAt,
        uint256 deliveredAt,
        uint256 resolvedAt
    ) {
        Task storage t = tasks[taskId];
        return (
            t.buyer,
            t.seller,
            t.amount,
            t.taskSpecCID,
            t.deliverableCID,
            t.state,
            t.ruling,
            t.createdAt,
            t.deliveredAt,
            t.resolvedAt
        );
    }

    function getTaskDeadlines(
        bytes32 taskId
    ) external view returns (uint256 deliverBy, uint256 reviewBy, uint256 reviewWindow) {
        Task storage t = tasks[taskId];
        return (t.deliverBy, t.reviewBy, t.reviewWindow);
    }

    function getTaskDisputeMeta(
        bytes32 taskId
    ) external view returns (address openedBy, DisputeReason reason) {
        Task storage t = tasks[taskId];
        return (t.disputeOpenedBy, t.disputeReason);
    }

    /**
     * @notice Check if a task exists
     * @param taskId The task to check
     */
    function taskExistsCheck(bytes32 taskId) external view returns (bool) {
        return tasks[taskId].buyer != address(0);
    }

    // ============ Admin Functions ============

    /**
     * @notice Update the arbitrator address
     * @param _newArbitrator New arbitrator address
     */
    function setArbitrator(address _newArbitrator) external onlyOwner {
        require(_newArbitrator != address(0), "Escrow: invalid arbitrator");
        address oldArbitrator = arbitrator;
        arbitrator = _newArbitrator;
        emit ArbitratorUpdated(oldArbitrator, _newArbitrator);
    }

    /**
     * @notice Set or update the ArbitratorPool for multi-sig dispute resolution
     * @param _pool ArbitratorPool address (address(0) to disable)
     */
    function setArbitratorPool(address _pool) external onlyOwner {
        address oldPool = address(arbitratorPool);
        arbitratorPool = IArbitratorPool(_pool);
        emit ArbitratorPoolUpdated(oldPool, _pool);
    }

    /**
     * @notice Update ReputationGate contract address
     * @param _newReputationGate New ReputationGate address
     */
    function setReputationGate(address _newReputationGate) external onlyOwner {
        require(_newReputationGate != address(0), "Escrow: invalid reputation gate");
        address oldReputationGate = address(reputationGate);
        reputationGate = IReputationGate(_newReputationGate);
        emit ReputationGateUpdated(oldReputationGate, _newReputationGate);
    }

    /**
     * @notice Update platform fee (max 5%)
     * @param _newFeeBps New fee in basis points
     */
    function setPlatformFee(uint256 _newFeeBps) external onlyOwner {
        require(_newFeeBps <= 500, "Escrow: fee cannot exceed 5%");
        platformFeeBps = _newFeeBps;
    }

    /**
     * @notice Set minimum reputation required for task participants
     * @param _newMinReputation Minimum score (0 = disable requirement)
     */
    function setMinimumReputation(uint256 _newMinReputation) external onlyOwner {
        uint256 old = minimumReputation;
        minimumReputation = _newMinReputation;
        emit MinimumReputationUpdated(old, _newMinReputation);
    }

    /**
     * @notice Set default delivery and review windows for new tasks
     * @param _deliveryWindow Default delivery window in seconds
     * @param _reviewWindow Default review window in seconds
     */
    function setDefaultWindows(uint256 _deliveryWindow, uint256 _reviewWindow) external onlyOwner {
        require(_deliveryWindow >= 60, "Escrow: delivery window too short");
        require(_reviewWindow >= 60, "Escrow: review window too short");
        defaultDeliveryWindow = _deliveryWindow;
        defaultReviewWindow = _reviewWindow;
        emit DefaultWindowsUpdated(_deliveryWindow, _reviewWindow);
    }

    /**
     * @notice Withdraw accumulated platform fees
     */
    function withdrawFees() external onlyOwner {
        uint256 amount = platformFees;
        platformFees = 0;
        (bool success, ) = payable(owner).call{value: amount}("");
        require(success, "Escrow: fee withdrawal failed");
    }

    /**
     * @notice Transfer contract ownership
     * @param _newOwner New owner address
     */
    function transferOwnership(address _newOwner) external onlyOwner {
        require(_newOwner != address(0), "Escrow: invalid owner");
        owner = _newOwner;
    }

    // ============ Internal Functions ============

    function _openDispute(bytes32 taskId, address opener, DisputeReason reason) internal {
        Task storage task = tasks[taskId];
        task.state = TaskState.Disputed;
        task.disputeOpenedBy = opener;
        task.disputeReason = reason;
        reputationGate.recordDisputeOpened(task.buyer, task.seller);
        if (address(arbitratorPool) != address(0)) {
            arbitratorPool.assignPanel(taskId);
        }
        emit DisputeOpened(taskId, opener, reason);
    }

    function _enforceMinimumReputation(address buyer, address seller) internal view {
        if (minimumReputation == 0) {
            return;
        }
        require(reputationGate.getReputation(buyer) >= minimumReputation, "Escrow: buyer reputation below minimum");
        require(reputationGate.getReputation(seller) >= minimumReputation, "Escrow: seller reputation below minimum");
    }

    function _enforceSuggestedTerms(address buyer, address seller, uint256 amount) internal view {
        (uint256 suggestedDeposit, ) = reputationGate.getSuggestedTerms(buyer, seller, amount);
        require(amount >= suggestedDeposit, "Escrow: amount below suggested deposit");
    }

    function _resolveDeliverBy(uint256 deliverByTimestamp) internal view returns (uint256) {
        uint256 deliverBy = deliverByTimestamp == 0 ? block.timestamp + defaultDeliveryWindow : deliverByTimestamp;
        require(deliverBy > block.timestamp, "Escrow: deliverBy must be in future");
        return deliverBy;
    }

    function _resolveReviewWindow(uint256 reviewWindowSeconds) internal view returns (uint256) {
        uint256 reviewWindow = reviewWindowSeconds == 0 ? defaultReviewWindow : reviewWindowSeconds;
        require(reviewWindow >= 60, "Escrow: review window too short");
        return reviewWindow;
    }
}
