// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ArbiChain Escrow
 * @notice Core escrow contract for AI agent commerce with dispute resolution
 * @dev Handles task creation, deliverable submission, approval, and arbitration
 */
contract Escrow {
    // ============ Enums ============

    enum TaskState {
        Created,    // Task created but not yet funded
        Funded,     // Buyer has locked funds in escrow
        Delivered,  // Seller has submitted deliverable
        Approved,   // Buyer approved, funds released to seller
        Disputed,   // Buyer opened a dispute
        Resolved    // Arbitrator resolved the dispute
    }

    enum DisputeRuling {
        None,           // No ruling yet
        RefundBuyer,    // Arbitrator ruled in favor of buyer
        PaySeller       // Arbitrator ruled in favor of seller
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
        uint256 createdAt;          // Timestamp of task creation
        uint256 deliveredAt;        // Timestamp of deliverable submission
        uint256 resolvedAt;         // Timestamp of resolution
    }

    // ============ State Variables ============

    // Mapping from taskId to Task struct
    mapping(bytes32 => Task) public tasks;

    // Designated arbitrator address (can be a DAO or multi-sig in production)
    address public arbitrator;

    // Contract owner for admin functions
    address public owner;

    // Platform fee percentage (in basis points, e.g., 100 = 1%)
    uint256 public platformFeeBps = 100;

    // Accumulated platform fees
    uint256 public platformFees;

    // ============ Events ============

    event TaskCreated(
        bytes32 indexed taskId,
        address indexed buyer,
        address indexed seller,
        uint256 amount,
        string taskSpecCID
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
        address indexed buyer,
        address indexed seller
    );

    event DisputeResolved(
        bytes32 indexed taskId,
        DisputeRuling ruling,
        address indexed winner
    );

    event ArbitratorUpdated(address indexed oldArbitrator, address indexed newArbitrator);

    // ============ Modifiers ============

    modifier onlyOwner() {
        require(msg.sender == owner, "Escrow: caller is not owner");
        _;
    }

    modifier onlyArbitrator() {
        require(msg.sender == arbitrator, "Escrow: caller is not arbitrator");
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
     */
    constructor(address _arbitrator) {
        require(_arbitrator != address(0), "Escrow: invalid arbitrator address");
        owner = msg.sender;
        arbitrator = _arbitrator;
    }

    // ============ Core Functions ============

    /**
     * @notice Create a new task and lock funds in escrow
     * @param taskId Unique identifier for the task (generated off-chain)
     * @param seller Address of the seller who will fulfill the task
     * @param taskSpecCID Filecoin CID containing task specification/requirements
     * @dev Buyer sends TRX which gets locked in the contract
     */
    function createTask(
        bytes32 taskId,
        address seller,
        string calldata taskSpecCID
    ) external payable {
        require(msg.value > 0, "Escrow: must send TRX to create task");
        require(seller != address(0), "Escrow: invalid seller address");
        require(seller != msg.sender, "Escrow: buyer cannot be seller");
        require(tasks[taskId].buyer == address(0), "Escrow: task already exists");
        require(bytes(taskSpecCID).length > 0, "Escrow: taskSpecCID required");

        tasks[taskId] = Task({
            buyer: msg.sender,
            seller: seller,
            amount: msg.value,
            taskSpecCID: taskSpecCID,
            deliverableCID: "",
            state: TaskState.Funded,
            ruling: DisputeRuling.None,
            createdAt: block.timestamp,
            deliveredAt: 0,
            resolvedAt: 0
        });

        emit TaskCreated(taskId, msg.sender, seller, msg.value, taskSpecCID);
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

        task.deliverableCID = deliverableCID;
        task.state = TaskState.Delivered;
        task.deliveredAt = block.timestamp;

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

        task.state = TaskState.Approved;
        task.resolvedAt = block.timestamp;

        // Calculate and deduct platform fee
        uint256 fee = (task.amount * platformFeeBps) / 10000;
        uint256 sellerAmount = task.amount - fee;
        platformFees += fee;

        // Transfer funds to seller
        (bool success, ) = payable(task.seller).call{value: sellerAmount}("");
        require(success, "Escrow: transfer to seller failed");

        emit DeliverableApproved(taskId, task.buyer, task.seller, sellerAmount);
    }

    /**
     * @notice Buyer opens a dispute for a delivered task
     * @param taskId The task to dispute
     */
    function openDispute(bytes32 taskId) external taskExists(taskId) {
        Task storage task = tasks[taskId];

        require(msg.sender == task.buyer, "Escrow: caller is not buyer");
        require(
            task.state == TaskState.Delivered,
            "Escrow: can only dispute delivered tasks"
        );

        task.state = TaskState.Disputed;

        emit DisputeOpened(taskId, task.buyer, task.seller);
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
            emit DisputeResolved(taskId, DisputeRuling.RefundBuyer, task.buyer);
        } else {
            // Pay seller (with platform fee deduction)
            task.ruling = DisputeRuling.PaySeller;
            uint256 fee = (task.amount * platformFeeBps) / 10000;
            uint256 sellerAmount = task.amount - fee;
            platformFees += fee;

            (bool success, ) = payable(task.seller).call{value: sellerAmount}("");
            require(success, "Escrow: payment to seller failed");
            emit DisputeResolved(taskId, DisputeRuling.PaySeller, task.seller);
        }
    }

    // ============ View Functions ============

    /**
     * @notice Get full task details
     * @param taskId The task to query
     */
    function getTask(bytes32 taskId) external view returns (Task memory) {
        return tasks[taskId];
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
     * @notice Update platform fee (max 5%)
     * @param _newFeeBps New fee in basis points
     */
    function setPlatformFee(uint256 _newFeeBps) external onlyOwner {
        require(_newFeeBps <= 500, "Escrow: fee cannot exceed 5%");
        platformFeeBps = _newFeeBps;
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
}
