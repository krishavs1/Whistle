/**
 * ArbiChain - Buyer Agent
 * Autonomous agent that posts tasks, locks escrow, reviews deliverables, and disputes
 */

require('dotenv').config();
const { createTronWeb, getBalance, waitForConfirmation, generateTaskId } = require('../lib/tron');
const { uploadTaskSpec, retrieveJson } = require('../lib/filecoin');
const { TaskState, TaskStateLabels, generateTaskId: genId } = require('../lib/types');
const llm = require('../lib/llm');
const config = require('./config');

// Contract ABIs (simplified for key functions)
const ESCROW_ABI = [
  {
    "inputs": [{"name": "taskId", "type": "bytes32"}, {"name": "seller", "type": "address"}, {"name": "taskSpecCID", "type": "string"}],
    "name": "createTask",
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [{"name": "taskId", "type": "bytes32"}],
    "name": "approveDeliverable",
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"name": "taskId", "type": "bytes32"}],
    "name": "openDispute",
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"name": "taskId", "type": "bytes32"}],
    "name": "getTask",
    "outputs": [{"components": [
      {"name": "buyer", "type": "address"},
      {"name": "seller", "type": "address"},
      {"name": "amount", "type": "uint256"},
      {"name": "taskSpecCID", "type": "string"},
      {"name": "deliverableCID", "type": "string"},
      {"name": "state", "type": "uint8"},
      {"name": "ruling", "type": "uint8"},
      {"name": "createdAt", "type": "uint256"},
      {"name": "deliveredAt", "type": "uint256"},
      {"name": "resolvedAt", "type": "uint256"}
    ], "name": "", "type": "tuple"}],
    "stateMutability": "view",
    "type": "function"
  }
];

class BuyerAgent {
  constructor() {
    this.tronWeb = null;
    this.escrow = null;
    this.address = null;
    this.activeTasks = new Map(); // taskId -> task info
    this.isRunning = false;
  }

  /**
   * Initialize the buyer agent
   */
  async init() {
    console.log('\n🛒 Initializing Buyer Agent...');

    // Validate config
    if (!config.agents.buyer.privateKey) {
      throw new Error('BUYER_PRIVATE_KEY not set in environment');
    }
    if (!config.contracts.escrow) {
      throw new Error('ESCROW_ADDRESS not set in environment');
    }

    // Initialize TronWeb
    this.tronWeb = createTronWeb(config.agents.buyer.privateKey, config.network.name);
    this.address = this.tronWeb.defaultAddress.base58;

    // Connect to Escrow contract
    this.escrow = await this.tronWeb.contract(ESCROW_ABI, config.contracts.escrow);

    // Get balance
    const balance = await getBalance(this.tronWeb, this.address);

    console.log(`   Address: ${this.address}`);
    console.log(`   Balance: ${balance} TRX`);
    console.log(`   Escrow Contract: ${config.contracts.escrow}`);
    console.log('✅ Buyer Agent initialized\n');

    return this;
  }

  /**
   * Create a new task with escrow
   * @param {Object} taskSpec - Task specification
   * @param {string} sellerAddress - Seller's TRON address
   * @param {number} amountTrx - Amount to escrow in TRX
   * @returns {Object} Created task info
   */
  async createTask(taskSpec, sellerAddress, amountTrx) {
    console.log(`\n📝 Creating new task...`);
    console.log(`   Title: ${taskSpec.title}`);
    console.log(`   Seller: ${sellerAddress}`);
    console.log(`   Amount: ${amountTrx} TRX`);

    // Generate unique task ID
    const taskId = genId();
    console.log(`   Task ID: ${taskId}`);

    // Upload task spec to Filecoin
    console.log('   Uploading task spec to Filecoin...');
    const specUpload = await uploadTaskSpec({
      ...taskSpec,
      taskId,
      buyer: this.address,
      seller: sellerAddress,
      amount: amountTrx
    });
    console.log(`   Task Spec CID: ${specUpload.cid}`);

    // Create task on-chain with escrow
    console.log('   Locking escrow on TRON...');
    const amountSun = this.tronWeb.toSun(amountTrx);

    const tx = await this.escrow.createTask(
      taskId,
      sellerAddress,
      specUpload.cid
    ).send({
      callValue: amountSun,
      feeLimit: 100000000
    });

    console.log(`   Transaction: ${tx}`);

    // Wait for confirmation
    await waitForConfirmation(this.tronWeb, tx);

    // Track the task
    const taskInfo = {
      taskId,
      seller: sellerAddress,
      amount: amountTrx,
      specCID: specUpload.cid,
      txHash: tx,
      state: TaskState.FUNDED,
      createdAt: Date.now()
    };
    this.activeTasks.set(taskId, taskInfo);

    console.log(`✅ Task created and escrow locked!`);
    console.log(`   View on explorer: ${config.network.explorerUrl}/#/transaction/${tx}\n`);

    return taskInfo;
  }

  /**
   * Check task status and deliverable
   * @param {string} taskId - Task ID to check
   * @returns {Object} Task details
   */
  async checkTask(taskId) {
    const task = await this.escrow.getTask(taskId).call();

    return {
      taskId,
      buyer: this.tronWeb.address.fromHex(task.buyer),
      seller: this.tronWeb.address.fromHex(task.seller),
      amount: this.tronWeb.fromSun(task.amount.toString()),
      taskSpecCID: task.taskSpecCID,
      deliverableCID: task.deliverableCID,
      state: Number(task.state),
      stateLabel: TaskStateLabels[Number(task.state)],
      ruling: Number(task.ruling),
      createdAt: Number(task.createdAt) * 1000,
      deliveredAt: Number(task.deliveredAt) * 1000,
      resolvedAt: Number(task.resolvedAt) * 1000
    };
  }

  /**
   * Review a deliverable (returns assessment)
   * @param {string} taskId - Task ID
   * @returns {Object} Review result
   */
  async reviewDeliverable(taskId) {
    console.log(`\n🔍 Reviewing deliverable for task ${taskId.slice(0, 10)}...`);

    const task = await this.checkTask(taskId);

    if (task.state !== TaskState.DELIVERED) {
      console.log(`   Task is not in DELIVERED state (current: ${task.stateLabel})`);
      return { accepted: false, reason: 'Task not delivered yet' };
    }

    // Fetch task spec and deliverable from Filecoin
    console.log('   Fetching task spec from Filecoin...');
    const taskSpec = await retrieveJson(task.taskSpecCID);

    console.log('   Fetching deliverable from Filecoin...');
    const deliverable = await retrieveJson(task.deliverableCID);

    console.log('   Task Spec:', JSON.stringify(taskSpec, null, 2).slice(0, 200) + '...');
    console.log('   Deliverable:', JSON.stringify(deliverable, null, 2).slice(0, 200) + '...');

    const review = await this.evaluateDeliverableWithPolicy(taskSpec, deliverable);

    console.log(`   Review Result: ${review.accepted ? 'ACCEPTED' : 'REJECTED'}`);
    console.log(`   Reason: ${review.reason}`);
    if (review.source) {
      console.log(`   Source: ${review.source}`);
    }

    return review;
  }

  /**
   * Heuristic gate + optional OpenAI buyer review (English).
   * @param {object} taskSpec
   * @param {object} deliverable
   * @returns {Promise<object>}
   */
  async evaluateDeliverableWithPolicy(taskSpec, deliverable) {
    if (!deliverable || !deliverable.content) {
      return { accepted: false, reason: 'Deliverable has no content', source: 'heuristic' };
    }

    if (deliverable.taskId && deliverable.taskId !== taskSpec.taskId) {
      return { accepted: false, reason: 'Deliverable taskId mismatch', source: 'heuristic' };
    }

    const contentStr = JSON.stringify(deliverable.content);
    if (contentStr.length < 50) {
      return { accepted: false, reason: 'Deliverable content too short', source: 'heuristic' };
    }

    if (llm.useLlmBuyer()) {
      try {
        console.log('   Using OpenAI buyer review (model:', llm.getModel() + ')...');
        const out = await llm.evaluateBuyerDeliverable(taskSpec, deliverable);
        return {
          accepted: out.accepted,
          reason: out.reason,
          confidence: out.confidence,
          requirement_results: out.requirement_results,
          source: 'openai',
        };
      } catch (err) {
        console.warn('   LLM buyer failed, using heuristic:', err.message);
      }
    }

    return {
      accepted: true,
      reason: 'Deliverable passes basic checks (no LLM or LLM failed)',
      source: 'heuristic',
    };
  }

  /**
   * @deprecated Use evaluateDeliverableWithPolicy (async).
   */
  evaluateDeliverable(taskSpec, deliverable) {
    if (!deliverable || !deliverable.content) {
      return { accepted: false, reason: 'Deliverable has no content' };
    }
    if (deliverable.taskId && deliverable.taskId !== taskSpec.taskId) {
      return { accepted: false, reason: 'Deliverable taskId mismatch' };
    }
    const contentStr = JSON.stringify(deliverable.content);
    if (contentStr.length < 50) {
      return { accepted: false, reason: 'Deliverable content too short' };
    }
    return { accepted: true, reason: 'Basic checks only (sync)' };
  }

  /**
   * Approve a deliverable and release funds to seller
   * @param {string} taskId - Task ID to approve
   */
  async approveDeliverable(taskId) {
    console.log(`\n✅ Approving deliverable for task ${taskId.slice(0, 10)}...`);

    const tx = await this.escrow.approveDeliverable(taskId).send({
      feeLimit: 50000000
    });

    console.log(`   Transaction: ${tx}`);
    await waitForConfirmation(this.tronWeb, tx);

    // Update local tracking
    if (this.activeTasks.has(taskId)) {
      this.activeTasks.get(taskId).state = TaskState.APPROVED;
    }

    console.log(`✅ Deliverable approved! Funds released to seller.`);
    console.log(`   View on explorer: ${config.network.explorerUrl}/#/transaction/${tx}\n`);

    return tx;
  }

  /**
   * Open a dispute for a delivered task
   * @param {string} taskId - Task ID to dispute
   * @param {string} reason - Reason for dispute
   */
  async openDispute(taskId, reason = 'Deliverable does not meet requirements') {
    console.log(`\n⚠️ Opening dispute for task ${taskId.slice(0, 10)}...`);
    console.log(`   Reason: ${reason}`);

    const tx = await this.escrow.openDispute(taskId).send({
      feeLimit: 50000000
    });

    console.log(`   Transaction: ${tx}`);
    await waitForConfirmation(this.tronWeb, tx);

    // Update local tracking
    if (this.activeTasks.has(taskId)) {
      this.activeTasks.get(taskId).state = TaskState.DISPUTED;
      this.activeTasks.get(taskId).disputeReason = reason;
    }

    console.log(`⚠️ Dispute opened! Awaiting arbitrator ruling.`);
    console.log(`   View on explorer: ${config.network.explorerUrl}/#/transaction/${tx}\n`);

    return tx;
  }

  /**
   * Monitor active tasks for deliverables
   */
  async monitorTasks() {
    for (const [taskId, info] of this.activeTasks) {
      if (info.state === TaskState.FUNDED) {
        const task = await this.checkTask(taskId);

        if (task.state === TaskState.DELIVERED) {
          console.log(`\n📦 New deliverable received for task ${taskId.slice(0, 10)}`);

          // Update local state
          info.state = TaskState.DELIVERED;
          info.deliverableCID = task.deliverableCID;

          // Auto-review if enabled
          if (config.behavior.autoApproveEnabled) {
            const review = await this.reviewDeliverable(taskId);
            if (review.accepted) {
              await this.approveDeliverable(taskId);
            } else {
              await this.openDispute(taskId, review.reason);
            }
          }
        }
      }
    }
  }

  /**
   * Start autonomous monitoring loop
   */
  async start() {
    console.log('🚀 Starting Buyer Agent monitoring loop...');
    this.isRunning = true;

    while (this.isRunning) {
      try {
        await this.monitorTasks();
      } catch (error) {
        console.error('Monitor error:', error.message);
      }

      await this.sleep(config.behavior.pollInterval);
    }
  }

  /**
   * Stop the agent
   */
  stop() {
    console.log('🛑 Stopping Buyer Agent...');
    this.isRunning = false;
  }

  /**
   * Get agent status
   */
  getStatus() {
    return {
      address: this.address,
      activeTasks: this.activeTasks.size,
      tasks: Array.from(this.activeTasks.values()),
      isRunning: this.isRunning
    };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// CLI interface
async function main() {
  const agent = new BuyerAgent();
  await agent.init();

  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'create': {
      // Example: node buyer.js create <seller_address> <amount_trx>
      const seller = args[1];
      const amount = parseFloat(args[2]) || 10;

      if (!seller) {
        console.log('Usage: node buyer.js create <seller_address> <amount_trx>');
        process.exit(1);
      }

      const taskSpec = {
        title: 'Generate AI content',
        description: 'Create a short article about blockchain technology',
        requirements: [
          'Minimum 200 words',
          'Include introduction and conclusion',
          'Original content'
        ],
        deliverableFormat: 'JSON with content field'
      };

      await agent.createTask(taskSpec, seller, amount);
      break;
    }

    case 'check': {
      // Example: node buyer.js check <task_id>
      const taskId = args[1];
      if (!taskId) {
        console.log('Usage: node buyer.js check <task_id>');
        process.exit(1);
      }

      const task = await agent.checkTask(taskId);
      console.log('\nTask Details:', JSON.stringify(task, null, 2));
      break;
    }

    case 'approve': {
      const taskId = args[1];
      if (!taskId) {
        console.log('Usage: node buyer.js approve <task_id>');
        process.exit(1);
      }

      await agent.approveDeliverable(taskId);
      break;
    }

    case 'dispute': {
      const taskId = args[1];
      const reason = args[2] || 'Quality not acceptable';
      if (!taskId) {
        console.log('Usage: node buyer.js dispute <task_id> [reason]');
        process.exit(1);
      }

      await agent.openDispute(taskId, reason);
      break;
    }

    case 'monitor': {
      await agent.start();
      break;
    }

    default:
      console.log(`
ArbiChain Buyer Agent

Commands:
  create <seller> <amount>  Create a new task with escrow
  check <taskId>            Check task status
  approve <taskId>          Approve deliverable and release funds
  dispute <taskId> [reason] Open a dispute
  monitor                   Start monitoring loop

Examples:
  node buyer.js create TXyZ...abc 10
  node buyer.js check 0x1234...
  node buyer.js approve 0x1234...
  node buyer.js dispute 0x1234... "Poor quality"
      `);
  }
}

// Export for programmatic use
module.exports = BuyerAgent;

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}
